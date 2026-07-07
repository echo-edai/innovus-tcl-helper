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
     * .f 文件格式：每行一个文件路径（相对于 .f 文件所在目录），忽略 # 注释行和空行。
     */
    private parseFFile(
        fFilePath: string,
        workspaceRoot: string,
        errors: CompileError[]
    ): string[] {
        const result: string[] = [];

        if (!fs.existsSync(fFilePath)) {
            return result;
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

                // 解析为路径（相对 .f 文件目录或绝对路径）
                let absPath: string;
                if (path.isAbsolute(cleanLine)) {
                    absPath = cleanLine;
                } else {
                    absPath = path.resolve(fDir, cleanLine);
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

        this.compileOrder = [...result];
        return result;
    }

    /**
     * 处理 source 命令，将引用的文件插入编译顺序。
     */
    private processSourceCommands(
        parseResult: ParseResult,
        currentFilePath: string,
        currentOrder: number,
        fileList: string[],
        errors: CompileError[]
    ): void {
        const currentDir = path.dirname(currentFilePath);
        for (const srcNode of parseResult.sources) {
            let absPath: string;
            if (path.isAbsolute(srcNode.filePath)) {
                absPath = srcNode.filePath;
            } else {
                absPath = path.resolve(currentDir, srcNode.filePath);
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
