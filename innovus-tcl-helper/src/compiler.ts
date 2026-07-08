/**
 * TCL 编译引擎 — 跨文件变量追踪与符号表
 *
 * 核心功能:
 *   1. 解析 .f 文件获取 TCL 脚本列表和加载顺序
 *   2. 按顺序编译每个 TCL 文件，构建全局符号表
 *   3. 追踪变量定义位置、值、引用位置
 *   4. 支持增量编译（文件变化时局部更新）
 *   5. 处理 source 命令的嵌套文件包含
 *
 * 符号表:
 *   SymbolTable:
 *     variables: Map<varName, VariableInfo[]>
 *       每个变量可能有多个定义（不同文件/行），按文件顺序排列
 *
 *   VariableInfo:
 *     name: 变量名
 *     value: 解析后的值（简单值）
 *     rawValue: 原始值文本
 *     filePath: 定义所在文件
 *     line: 定义行号
 *     column: 定义列号
 *     isResolved: 值是否已完全解析（不含未解析的变量引用）
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    parse, ParseResult, AstNode,
    SetNode, VarRefNode, SourceNode, ProcNode,
    CommandNode, TokenType,
    resolveSimpleValue, containsVarRef
} from './tcl-ast';

// ════════════════════════════════════════════════════════════
//  类型定义
// ════════════════════════════════════════════════════════════

/** 变量信息 */
export interface VariableInfo {
    name: string;
    value: string;             // 解析后的简单值
    rawValue: string;          // 原始值文本
    filePath: string;          // 定义所在文件的绝对路径
    relativePath: string;      // 相对工作区根目录的路径
    line: number;              // 1-based
    column: number;            // 1-based
    order: number;             // 在编译顺序中的序号（越小越早）
    isResolved: boolean;       // 值是否已完全解析
    rawText: string;           // 原始 set 命令文本
}

/** 变量引用信息 */
export interface VariableRefInfo {
    name: string;
    filePath: string;
    relativePath: string;
    line: number;
    column: number;
    rawText: string;
    definition: VariableInfo | null;  // 解析到的定义
}

/** 编译单元（一个 TCL 文件） */
export interface CompilationUnit {
    filePath: string;           // 绝对路径
    relativePath: string;       // 相对路径
    order: number;              // 编译顺序
    parseResult: ParseResult;
    sets: SetNode[];
    varRefs: VarRefNode[];
    sources: SourceNode[];
    procs: ProcNode[];
}

/** 编译结果 */
export interface CompileResult {
    workspaceRoot: string;
    fFilePath: string;          // .f 文件的绝对路径
    units: CompilationUnit[];   // 按编译顺序排列
    variables: Map<string, VariableInfo[]>;  // 全局变量表
    variableRefs: VariableRefInfo[];          // 所有变量引用
    errors: CompileError[];     // 编译错误
    warnings: CompileWarning[]; // 编译警告
}

export interface CompileError {
    message: string;
    filePath: string;
    line: number;
    column: number;
}

export interface CompileWarning {
    message: string;
    filePath: string;
    line: number;
    column: number;
}

// ════════════════════════════════════════════════════════════
//  命令变量提取 — TCL 命令隐式定义的变量
// ════════════════════════════════════════════════════════════

/**
 * 从 TCL 命令中提取隐式定义的变量名（foreach、lassign、gets、catch、scan 等），
 * 并将其添加到符号表。
 *
 * @param cmd       - 解析后的命令节点
 * @param unit      - 当前编译单元
 * @param line      - 命令所在行号（已偏移处理）
 * @param column    - 命令所在列号
 * @param variables - 符号表（原地修改）
 */
function addCmdDefinedVars(
    cmd: CommandNode,
    unit: CompilationUnit,
    line: number,
    column: number,
    variables: Map<string, VariableInfo[]>
): void {
    const cmdName = cmd.commandName;
    const args = cmd.args;

    /** 添加一个变量定义的便捷方法 */
    const addVar = (varName: string, source: string): void => {
        if (!varName || varName.startsWith('-')) { return; }
        const info: VariableInfo = {
            name: varName,
            value: `<${source}>`,
            rawValue: `<${source}>`,
            filePath: unit.filePath,
            relativePath: unit.relativePath,
            line,
            column,
            order: unit.order,
            isResolved: true,
            rawText: cmd.rawText
        };
        const existing = variables.get(varName);
        if (existing) {
            existing.push(info);
        } else {
            variables.set(varName, [info]);
        }
    };

    // ── foreach varname list body ──
    // ── foreach {v1 v2 ...} list body ──
    if (cmdName === 'foreach' && args.length >= 3) {
        const varArg = args[0];
        const varNames: string[] = [];
        if (varArg.type === TokenType.BRACED) {
            varNames.push(...varArg.value.trim().split(/\s+/).filter(a => a.length > 0));
        } else if (varArg.type === TokenType.WORD) {
            varNames.push(varArg.value);
        }
        for (const vn of varNames) { addVar(vn, 'foreach'); }
        return;
    }

    // ── lassign list var1 var2 ... ──
    if (cmdName === 'lassign' && args.length >= 2) {
        for (let ai = 1; ai < args.length; ai++) {
            if (args[ai].type === TokenType.WORD) {
                addVar(args[ai].value, 'lassign');
            }
        }
        return;
    }

    // ── gets channelId ?varname? ──
    // 如果提供第二个参数，该变量接收读取的一行数据
    if (cmdName === 'gets' && args.length >= 2) {
        const varArg = args[1];
        if (varArg.type === TokenType.WORD) {
            addVar(varArg.value, 'gets');
        }
        return;
    }

    // ── catch script ?resultVar? ?optionsVar? ──
    // 从第 2 个参数开始是变量名（先跳过花括号的 script body）
    if (cmdName === 'catch' && args.length >= 2) {
        // 跳过第一个参数（script），后续参数为变量名
        for (let ai = 1; ai < args.length; ai++) {
            if (args[ai].type === TokenType.WORD) {
                addVar(args[ai].value, 'catch');
            }
        }
        return;
    }

    // ── scan string format var1 var2 ... ──
    // 前两个参数是字符串和格式，后续为接收扫描结果的变量
    if (cmdName === 'scan' && args.length >= 3) {
        for (let ai = 2; ai < args.length; ai++) {
            if (args[ai].type === TokenType.WORD) {
                addVar(args[ai].value, 'scan');
            }
        }
        return;
    }
}

/**
 * 获取控制流命令的 body 花括号 token 索引列表。
 * 用于递归解析嵌套的代码块（if/while/for/foreach/switch 体及其 init/incr 块）。
 *
 * @returns 参数数组中属于可执行代码花括号的索引
 */
function getControlFlowBodyIndices(cmdName: string, args: CommandNode['args']): number[] {
    const indices: number[] = [];

    switch (cmdName) {
        case 'foreach':
            // foreach varname list body → args[2] 是 body
            if (args.length >= 3 && args[2].type === TokenType.BRACED) {
                indices.push(2);
            }
            break;

        case 'while':
            // while cond body → args[1] 是 body
            if (args.length >= 2 && args[1].type === TokenType.BRACED) {
                indices.push(1);
            }
            break;

        case 'for':
            // for init cond incr body
            // args[0]=init（可含 set）, args[2]=incr（可含 set）, args[3]=body
            if (args.length >= 1 && args[0].type === TokenType.BRACED) {
                indices.push(0);  // init 块
            }
            if (args.length >= 3 && args[2].type === TokenType.BRACED) {
                indices.push(2);  // incr 块
            }
            if (args.length >= 4 && args[3].type === TokenType.BRACED) {
                indices.push(3);  // body 块
            }
            break;

        case 'if':
            // if cond body → args[1] 是 body
            if (args.length >= 2 && args[1].type === TokenType.BRACED) {
                indices.push(1);
            }
            // if cond body else {elseBody} → args[3] 是 else body
            // if cond body elseif {cond2} {body2} → args[3], args[4] ...
            // 扫描后续的 BRACED args（跳过中间的 WORD 如 "else"/"elseif"）
            for (let i = 2; i < args.length; i++) {
                if (args[i].type === TokenType.BRACED) {
                    indices.push(i);
                }
            }
            break;

        case 'elseif':
            // elseif cond body → args[1] 是 body
            if (args.length >= 2 && args[1].type === TokenType.BRACED) {
                indices.push(1);
            }
            break;

        case 'else':
            // else body → args[0] 是 body（else 可能被解析为命令名，body 是 args[0]）
            if (args.length >= 1 && args[0].type === TokenType.BRACED) {
                indices.push(0);
            }
            break;

        case 'switch':
            // switch ?opts? val body1 body2 ... → 所有 trailing BRACED args
            // 跳过前 1-2 个非 BRACED args（opts 和 val）
            for (let i = 0; i < args.length; i++) {
                if (args[i].type === TokenType.BRACED) {
                    indices.push(i);
                }
            }
            break;

        case 'try':
            // try body ?on? ?trap? ?finally?
            // 所有 BRACED args 都是代码块
            for (let i = 0; i < args.length; i++) {
                if (args[i].type === TokenType.BRACED) {
                    indices.push(i);
                }
            }
            break;
    }

    return indices;
}

/**
 * 递归从解析结果中提取所有变量定义（包括嵌套的控制流体）。
 *
 * @param parseResult  - 解析结果
 * @param unit         - 编译单元
 * @param lineOffset   - 行号偏移（parse 内行号 + offset = 文件实际行号）
 * @param variables    - 符号表（原地修改）
 * @param depth        - 当前递归深度（限制最大 4 层）
 */
function extractVarsDeep(
    parseResult: ParseResult,
    unit: CompilationUnit,
    lineOffset: number,
    variables: Map<string, VariableInfo[]>,
    depth: number = 0
): void {
    if (depth > 4) { return; } // 防止无限递归

    // 1. 提取 set 定义
    for (const setNode of parseResult.sets) {
        const info: VariableInfo = {
            name: setNode.varName,
            value: resolveSimpleValue(setNode.valueText),
            rawValue: setNode.valueText,
            filePath: unit.filePath,
            relativePath: unit.relativePath,
            line: setNode.line + lineOffset,
            column: setNode.column,
            order: unit.order,
            isResolved: !containsVarRef(setNode.valueText),
            rawText: setNode.rawText
        };
        const existing = variables.get(setNode.varName);
        if (existing) {
            existing.push(info);
        } else {
            variables.set(setNode.varName, [info]);
        }
    }

    // 2. 提取命令隐式定义的变量（foreach, lassign, gets, catch, scan）
    for (const cmd of parseResult.commands) {
        addCmdDefinedVars(cmd, unit, cmd.line + lineOffset, cmd.column, variables);

        // 3. 递归解析控制流体的 body 花括号
        const bodyIndices = getControlFlowBodyIndices(cmd.commandName, cmd.args);
        for (const bi of bodyIndices) {
            const bodyToken = cmd.args[bi];
            // bodyToken.value 是花括号内的文本（不含外层 {}）
            const bodyText = bodyToken.value;
            if (!bodyText || bodyText.trim().length === 0) { continue; }
            const bodyParseResult = parse(unit.filePath, bodyText);
            // bodyToken.line 是 { 所在行，body 内的代码从下一行开始
            const bodyLineOffset = bodyToken.line - 1;
            extractVarsDeep(bodyParseResult, unit, bodyLineOffset, variables, depth + 1);
        }
    }
}

// ════════════════════════════════════════════════════════════
//  编译引擎
// ════════════════════════════════════════════════════════════

export class TclCompiler {
    private workspaceRoot: string = '';
    private fFilePath: string = '';
    private cache: Map<string, ParseResult> = new Map();
    private compileOrder: string[] = []; // 绝对路径列表
    private processedSourceFiles: Set<string> = new Set(); // 防止循环 source

    constructor() { }

    /**
     * 编译整个项目。
     * @param workspaceRoot - VS Code 工作区根目录
     * @param fFileRelPath - .f 文件相对路径（默认 "tcl.f"）
     */
    compile(workspaceRoot: string, fFileRelPath: string = 'tcl.f'): CompileResult {
        this.workspaceRoot = workspaceRoot;
        this.fFilePath = path.join(workspaceRoot, fFileRelPath);
        this.cache.clear();
        this.compileOrder = [];
        this.processedSourceFiles.clear();

        const errors: CompileError[] = [];
        const warnings: CompileWarning[] = [];

        // 1. 解析 .f 文件
        const fileList = this.parseFFile(this.fFilePath, workspaceRoot, errors);
        if (fileList.length === 0 && errors.length === 0) {
            errors.push({
                message: `.f 文件为空或不存在: ${fFileRelPath}`,
                filePath: this.fFilePath,
                line: 1,
                column: 1
            });
        }

        // 2. 按顺序编译每个 TCL 文件
        const units: CompilationUnit[] = [];
        for (let i = 0; i < fileList.length; i++) {
            const absPath = fileList[i];
            const relPath = path.relative(workspaceRoot, absPath);

            if (!fs.existsSync(absPath)) {
                errors.push({
                    message: `文件不存在: ${relPath}`,
                    filePath: absPath,
                    line: 1,
                    column: 1
                });
                continue;
            }

            try {
                const content = fs.readFileSync(absPath, 'utf-8');
                const parseResult = this.getOrParse(absPath, content);

                const unit: CompilationUnit = {
                    filePath: absPath,
                    relativePath: relPath,
                    order: i,
                    parseResult,
                    sets: parseResult.sets,
                    varRefs: parseResult.varRefs,
                    sources: parseResult.sources,
                    procs: parseResult.procs
                };
                units.push(unit);

                // 处理 source 命令（嵌套文件包含）
                this.processSourceCommands(parseResult, absPath, i + 1, fileList, errors);

            } catch (e: any) {
                errors.push({
                    message: `读取文件失败: ${e.message}`,
                    filePath: absPath,
                    line: 1,
                    column: 1
                });
            }
        }

        // 3. 构建全局符号表
        const { variables, varRefs, varErrors, varWarnings } = this.buildSymbolTable(units);

        errors.push(...varErrors);
        warnings.push(...varWarnings);

        return {
            workspaceRoot,
            fFilePath: this.fFilePath,
            units,
            variables,
            variableRefs: varRefs,
            errors,
            warnings
        };
    }

    /**
     * 解析 .f 文件获取文件列表（按行顺序）。
     * 支持递归 -F / -f 指令：
     *   -F xxx.f：从当前 .f 所在目录找到 xxx.f，切换到 xxx.f 所在目录继续解析
     *   -f xxx.f：从当前 .f 所在目录找到 xxx.f，但其内部相对路径仍相对于调用者 .f 目录
     * 每行一个文件路径（相对于 .f 文件所在目录），忽略 # 注释行和空行。
     */
    private parseFFile(
        fFilePath: string,
        workspaceRoot: string,
        errors: CompileError[]
    ): string[] {
        const result: string[] = [];
        const visited = new Set<string>();

        this.parseFFileRecursive(fFilePath, path.dirname(fFilePath), workspaceRoot, errors, result, visited);
        this.compileOrder = [...result];
        return result;
    }

    /**
     * 递归解析 .f 文件。
     * @param fFilePath - 当前 .f 文件的绝对路径
     * @param baseDir - 当前行路径解析的基准目录（-f 模式下为调用者目录，-F 模式下为当前 .f 目录）
     * @param workspaceRoot - 工作区根目录
     * @param errors - 错误收集
     * @param result - 结果收集（追加）
     * @param visited - 已访问的 .f 文件集合（防循环）
     */
    private parseFFileRecursive(
        fFilePath: string,
        baseDir: string,
        workspaceRoot: string,
        errors: CompileError[],
        result: string[],
        visited: Set<string>
    ): void {
        // 规范化路径防重复
        const normalized = path.resolve(fFilePath);

        // 防循环：已访问过的 .f 文件不再处理
        if (visited.has(normalized)) {
            return;
        }
        visited.add(normalized);

        if (!fs.existsSync(fFilePath)) {
            errors.push({
                message: `.f 文件不存在: ${path.relative(workspaceRoot, fFilePath)}`,
                filePath: fFilePath,
                line: 1,
                column: 1
            });
            return;
        }

        try {
            const content = fs.readFileSync(fFilePath, 'utf-8');
            const fDir = path.dirname(fFilePath);
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                // 跳过空行和注释
                if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
                    continue;
                }

                // 移除行内注释（# 后面部分）
                const commentIdx = trimmed.indexOf('#');
                const cleanLine = commentIdx >= 0
                    ? trimmed.substring(0, commentIdx).trim()
                    : trimmed;

                if (!cleanLine) { continue; }

                // ── 处理 -F 指令：切换目录的递归 ──
                if (cleanLine.startsWith('-F') && (cleanLine.length === 2 || cleanLine[2] === ' ' || cleanLine[2] === '\t')) {
                    const subFPath = cleanLine.substring(2).trim();
                    if (!subFPath) {
                        errors.push({
                            message: `-F 指令缺少文件路径`,
                            filePath: fFilePath,
                            line: i + 1,
                            column: 1
                        });
                        continue;
                    }
                    // 解析 sub .f 路径（相对于当前 .f 所在目录）
                    const subFAbs = path.isAbsolute(subFPath)
                        ? subFPath
                        : path.resolve(fDir, subFPath);
                    // -F: 切换到 sub .f 所在目录作为新 baseDir
                    const subFDir = path.dirname(subFAbs);
                    this.parseFFileRecursive(subFAbs, subFDir, workspaceRoot, errors, result, visited);
                    continue;
                }

                // ── 处理 -f 指令：不切换目录的递归 ──
                if (cleanLine.startsWith('-f') && (cleanLine.length === 2 || cleanLine[2] === ' ' || cleanLine[2] === '\t')) {
                    const subFPath = cleanLine.substring(2).trim();
                    if (!subFPath) {
                        errors.push({
                            message: `-f 指令缺少文件路径`,
                            filePath: fFilePath,
                            line: i + 1,
                            column: 1
                        });
                        continue;
                    }
                    // 解析 sub .f 路径（相对于当前 .f 所在目录）
                    const subFAbs = path.isAbsolute(subFPath)
                        ? subFPath
                        : path.resolve(fDir, subFPath);
                    // -f: 保持当前 baseDir 不变（不切换到 sub .f 所在目录）
                    this.parseFFileRecursive(subFAbs, baseDir, workspaceRoot, errors, result, visited);
                    continue;
                }

                // ── 普通行：TCL 文件路径（相对于 baseDir 或绝对路径） ──
                let absPath: string;
                if (path.isAbsolute(cleanLine)) {
                    absPath = cleanLine;
                } else {
                    absPath = path.resolve(baseDir, cleanLine);
                }

                result.push(absPath);
            }
        } catch (e: any) {
            errors.push({
                message: `读取 .f 文件失败: ${e.message}`,
                filePath: fFilePath,
                line: 1,
                column: 1
            });
        }
    }

    /**
     * 处理 source 命令，将引用的文件插入编译顺序。
     */
    private processSourceCommands(
        parseResult: ParseResult,
        currentFilePath: string,
        currentOrder: number,
        fileList: string[],
        errors: CompileError[],
        variables?: Map<string, VariableInfo[]>
    ): void {
        const currentDir = path.dirname(currentFilePath);
        for (const srcNode of parseResult.sources) {
            let rawPath = srcNode.filePath;

            // 如果路径包含变量引用，尝试从符号表解析
            if (rawPath.includes('$')) {
                const resolved = this.resolveVarPath(rawPath, variables);
                if (!resolved) {
                    // 变量未定义，无法静态确定路径 — 跳过检查
                    continue;
                }
                rawPath = resolved;
            }

            let absPath: string;
            if (path.isAbsolute(rawPath)) {
                absPath = rawPath;
            } else {
                absPath = path.resolve(currentDir, rawPath);
            }

            // 防止循环引用
            if (this.processedSourceFiles.has(absPath)) {
                continue;
            }

            if (!fs.existsSync(absPath)) {
                errors.push({
                    message: `source 引用的文件不存在: ${srcNode.filePath}`,
                    filePath: currentFilePath,
                    line: srcNode.line,
                    column: srcNode.column
                });
                continue;
            }

            // 如果不在 fileList 中，追加到末尾
            if (!fileList.includes(absPath)) {
                fileList.push(absPath);
                this.compileOrder.push(absPath);
            }
            this.processedSourceFiles.add(absPath);
        }
    }

    /**
     * 解析路径中的 $varName 变量引用。
     * @returns 解析后的路径，若变量未定义则返回 null
     */
    private resolveVarPath(rawPath: string, variables?: Map<string, VariableInfo[]>): string | null {
        if (!variables) { return null; }

        let resolved = rawPath;
        const varRegex = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z0-9_]*)*)\}?/g;
        let match: RegExpExecArray | null;

        while ((match = varRegex.exec(rawPath)) !== null) {
            const varName = match[2];
            const defs = variables.get(varName);
            if (!defs || defs.length === 0) { return null; }
            // 使用最近的定义值
            const lastDef = defs[defs.length - 1];
            if (!lastDef.isResolved) { return null; }
            resolved = resolved.replace(match[0], lastDef.value);
        }

        return resolved;
    }

    /**
     * 获取或解析文件（使用缓存）。
     */
    private getOrParse(filePath: string, content: string): ParseResult {
        const cached = this.cache.get(filePath);
        if (cached) { return cached; }
        const result = parse(filePath, content);
        this.cache.set(filePath, result);
        return result;
    }

    /**
     * 构建全局符号表。
     * 按编译顺序处理每个文件的 set 和 varRef。
     */
    private buildSymbolTable(units: CompilationUnit[]): {
        variables: Map<string, VariableInfo[]>;
        varRefs: VariableRefInfo[];
        varErrors: CompileError[];
        varWarnings: CompileWarning[];
    } {
        // 变量: Map<varName, 定义信息列表(按编译顺序)>
        const variables = new Map<string, VariableInfo[]>();
        const varRefs: VariableRefInfo[] = [];
        const varErrors: CompileError[] = [];
        const varWarnings: CompileWarning[] = [];

        // 按编译顺序处理所有 set
        for (const unit of units) {
            for (const setNode of unit.sets) {
                const simpleValue = resolveSimpleValue(setNode.valueText);
                const hasUnresolved = containsVarRef(setNode.valueText);

                const info: VariableInfo = {
                    name: setNode.varName,
                    value: simpleValue,
                    rawValue: setNode.valueText,
                    filePath: unit.filePath,
                    relativePath: unit.relativePath,
                    line: setNode.line,
                    column: setNode.column,
                    order: unit.order,
                    isResolved: !hasUnresolved,
                    rawText: setNode.rawText
                };

                const existing = variables.get(setNode.varName);
                if (existing) {
                    existing.push(info);
                } else {
                    variables.set(setNode.varName, [info]);
                }
            }
        }

        // 处理 foreach / lassign / gets / catch / scan 等隐式变量定义
        for (const unit of units) {
            for (const cmd of unit.parseResult.commands) {
                addCmdDefinedVars(cmd, unit, cmd.line, cmd.column, variables);

                // 递归解析顶层控制流命令的代码块（for init/incr/body, if body 等）
                const bodyIndices = getControlFlowBodyIndices(cmd.commandName, cmd.args);
                for (const bi of bodyIndices) {
                    const bodyToken = cmd.args[bi];
                    const bodyText = bodyToken.value;
                    if (!bodyText || bodyText.trim().length === 0) { continue; }
                    const bodyResult = parse(unit.filePath, bodyText);
                    const bodyLineOffset = bodyToken.line - 1;
                    extractVarsDeep(bodyResult, unit, bodyLineOffset, variables);
                }
            }

            // 处理 proc 体内的所有变量定义（递归解析嵌套控制流体）
            for (const proc of unit.procs) {
                if (!proc.bodyText) { continue; }
                const bodyResult = parse(unit.filePath, proc.bodyText);
                const lineOffset = proc.bodyStartLine - 1;

                // 递归提取 proc 体内所有变量（包括 if/while/for/foreach/switch 嵌套体）
                extractVarsDeep(bodyResult, unit, lineOffset, variables);
            }
        }

        // 解析变量之间的引用关系
        for (const unit of units) {
            for (const refNode of unit.varRefs) {
                const varName = refNode.varName;
                const definitions = variables.get(varName);

                // 找到在此引用之前（按编译顺序）的最近定义
                let definition: VariableInfo | null = null;
                if (definitions && definitions.length > 0) {
                    // 找最接近的定义（同文件中此引用之前，或之前文件中的定义）
                    for (let di = definitions.length - 1; di >= 0; di--) {
                        const def = definitions[di];
                        if (def.order < unit.order ||
                            (def.order === unit.order && def.line <= refNode.line)) {
                            definition = def;
                            break;
                        }
                    }
                    // 如果所有定义都在引用之后，取第一个（可能是前置声明）
                    if (!definition) {
                        definition = definitions[0];
                        varWarnings.push({
                            message: `变量 "${varName}" 在使用之后定义（文件 ${unit.relativePath}:${refNode.line}，定义在 ${definition.relativePath}:${definition.line}）`,
                            filePath: unit.filePath,
                            line: refNode.line,
                            column: refNode.column
                        });
                    }
                } else {
                    // 未定义的变量
                    // 检查是否为 proc 参数
                    let isProcArg = false;
                    for (const pu of units) {
                        for (const proc of pu.procs) {
                            if (proc.args.includes(varName)) {
                                isProcArg = true;
                                break;
                            }
                        }
                        if (isProcArg) { break; }
                    }

                    if (!isProcArg) {
                        varErrors.push({
                            message: `未定义的变量 "${varName}"`,
                            filePath: unit.filePath,
                            line: refNode.line,
                            column: refNode.column
                        });
                    }
                }

                const refInfo: VariableRefInfo = {
                    name: varName,
                    filePath: unit.filePath,
                    relativePath: unit.relativePath,
                    line: refNode.line,
                    column: refNode.column,
                    rawText: refNode.rawText,
                    definition
                };
                varRefs.push(refInfo);
            }
        }

        return { variables, varRefs, varErrors, varWarnings };
    }

    /**
     * 增量编译：当单个文件变化时更新符号表。
     * @param changedFilePath - 变化的文件绝对路径
     * @param content - 新的文件内容
     */
    incrementalUpdate(changedFilePath: string, content: string, lastResult: CompileResult): CompileResult {
        // 清除此文件的缓存
        this.cache.delete(changedFilePath);

        // 重新解析文件
        const parseResult = parse(changedFilePath, content);
        this.cache.set(changedFilePath, parseResult);

        // 查找或创建对应的 CompilationUnit
        const relPath = path.relative(lastResult.workspaceRoot, changedFilePath);
        let unit = lastResult.units.find(u => u.filePath === changedFilePath);
        const order = unit ? unit.order : lastResult.units.length;

        const newUnit: CompilationUnit = {
            filePath: changedFilePath,
            relativePath: relPath,
            order,
            parseResult,
            sets: parseResult.sets,
            varRefs: parseResult.varRefs,
            sources: parseResult.sources,
            procs: parseResult.procs
        };

        if (unit) {
            // 替换旧单元
            const idx = lastResult.units.indexOf(unit);
            lastResult.units[idx] = newUnit;
        } else {
            lastResult.units.push(newUnit);
        }

        // 重建符号表
        const { variables, varRefs, varErrors, varWarnings } =
            this.buildSymbolTable(lastResult.units);

        lastResult.variables = variables;
        lastResult.variableRefs = varRefs;
        lastResult.errors = varErrors;
        lastResult.warnings = varWarnings;

        return lastResult;
    }

    /**
     * 查询变量定义信息。
     * @param varName 变量名
     * @param result 编译结果
     * @param refFile 引用所在文件
     * @param refLine 引用所在行
     */
    queryVariable(
        varName: string,
        result: CompileResult,
        refFile?: string,
        refLine?: number
    ): { definition: VariableInfo | null; allDefs: VariableInfo[]; refs: VariableRefInfo[] } {
        const allDefs = result.variables.get(varName) || [];
        const refs = result.variableRefs.filter(r => r.name === varName);

        let definition: VariableInfo | null = null;
        if (allDefs.length > 0) {
            if (refFile && refLine) {
                // 查找在此引用之前的最近定义
                const unit = result.units.find(u => u.filePath === refFile);
                const refOrder = unit ? unit.order : 99999;
                for (let di = allDefs.length - 1; di >= 0; di--) {
                    const def = allDefs[di];
                    if (def.order < refOrder ||
                        (def.order === refOrder && def.line <= refLine)) {
                        definition = def;
                        break;
                    }
                }
                if (!definition) {
                    definition = allDefs[allDefs.length - 1];
                }
            } else {
                // 取最后定义的值
                definition = allDefs[allDefs.length - 1];
            }
        }

        return { definition, allDefs, refs };
    }

    /**
     * 获取编译顺序中的所有文件路径。
     */
    getCompileOrder(): string[] {
        return [...this.compileOrder];
    }
}
