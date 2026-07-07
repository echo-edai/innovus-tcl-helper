/**
 * Diagnostics Provider - TCL 语法静态检查 + Innovus 命令参数校验
 *
 * 三级检查（由 innovus-tcl.diagnosticLevel 配置控制）:
 *   "basic"    — 括号匹配、引号匹配
 *   "standard" — basic + 命令参数必需性检查
 *   "strict"   — standard + 相似命令建议 + 参数类型验证 + 重复参数检测
 */

import * as vscode from 'vscode';
import { getDB } from './commands';

type DiagnosticLevel = 'basic' | 'standard' | 'strict';

export class TclDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    // TCL 内置命令集合
    private static readonly TCL_BUILTINS = new Set([
        'set', 'puts', 'if', 'else', 'elseif', 'for', 'foreach', 'while',
        'proc', 'return', 'source', 'eval', 'expr', 'switch', 'catch',
        'error', 'uplevel', 'upvar', 'global', 'variable', 'namespace',
        'package', 'array', 'list', 'lindex', 'llength', 'lappend',
        'concat', 'split', 'join', 'string', 'regexp', 'regsub',
        'open', 'close', 'read', 'write', 'gets', 'file', 'cd', 'pwd',
        'exec', 'after', 'vwait', 'bind', 'trace', 'rename', 'interp',
        'clock', 'info', 'scan', 'format', 'binary', 'encoding',
        'fconfigure', 'socket', 'incr', 'append', 'lrange', 'lsearch',
        'lsort', 'break', 'continue', 'dict', 'lassign', 'lset',
        'subst', 'unset'
    ]);

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('innovus-tcl');
    }

    /** 获取当前诊断级别 */
    private getLevel(): DiagnosticLevel {
        return vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('diagnosticLevel', 'standard') as DiagnosticLevel;
    }

    /** 对整个文档进行诊断 */
    updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'tcl') { return; }

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const db = getDB();
        const level = this.getLevel();

        // 1. 括号匹配检查（所有级别）
        this.checkBrackets(document, text, diagnostics);

        // 2. 引号匹配检查（所有级别）
        this.checkQuotes(document, text, diagnostics);

        // 3. 命令参数检查（standard + strict）
        if (level !== 'basic') {
            this.checkCommandArgs(document, text, diagnostics, db, level);
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /** 括号匹配检查 - 适配 TCL 的 [] {} 语法 */
    private checkBrackets(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const lines = text.split('\n');
        let braceDepth = 0;
        let bracketDepth = 0;
        let inString = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // 跳过纯注释行
            if (line.trimStart().startsWith('#')) { continue; }

            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                const prevCh = j > 0 ? line[j - 1] : '';

                // 跳过转义字符
                if (ch === '\\' && j + 1 < line.length) {
                    j++;
                    continue;
                }

                // 双引号字符串状态跟踪
                if (ch === '"' && prevCh !== '\\') {
                    inString = !inString;
                    continue;
                }

                // 跳过注释（不在字符串中）
                if (!inString && ch === '#' && prevCh !== '\\') {
                    break; // 行内注释，跳过剩余
                }

                // 字符串内的括号不计数（TCL 中字符串内的 [] 不会被执行）
                if (inString) { continue; }

                if (ch === '[') { bracketDepth++; }
                if (ch === ']') { bracketDepth--; }
                if (ch === '{') { braceDepth++; }
                if (ch === '}') { braceDepth--; }

                if (bracketDepth < 0) {
                    diagnostics.push(this.createDiagnostic(
                        document, i, j, j + 1,
                        '多余的右方括号 "]" — 没有匹配的左方括号',
                        vscode.DiagnosticSeverity.Error
                    ));
                    bracketDepth = 0;
                }
                if (braceDepth < 0) {
                    diagnostics.push(this.createDiagnostic(
                        document, i, j, j + 1,
                        '多余的右花括号 "}" — 没有匹配的左花括号',
                        vscode.DiagnosticSeverity.Error
                    ));
                    braceDepth = 0;
                }
            }
        }

        if (bracketDepth > 0) {
            const lastLine = lines.length - 1;
            diagnostics.push(this.createDiagnostic(
                document, lastLine, 0, 1,
                `缺少 ${bracketDepth} 个右方括号 "]" — 文件末尾仍有未闭合的方括号`,
                vscode.DiagnosticSeverity.Error
            ));
        }
        if (braceDepth > 0) {
            const lastLine = lines.length - 1;
            diagnostics.push(this.createDiagnostic(
                document, lastLine, 0, 1,
                `缺少 ${braceDepth} 个右花括号 "}" — 文件末尾仍有未闭合的花括号`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    /** 引号匹配检查 */
    private checkQuotes(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trimStart().startsWith('#')) { continue; }

            let inString = false;
            let stringStart = -1;

            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                // 跳过转义字符
                if (ch === '\\' && j + 1 < line.length) {
                    j++;
                    continue;
                }
                if (ch === '"') {
                    if (!inString) {
                        inString = true;
                        stringStart = j;
                    } else {
                        inString = false;
                    }
                }
            }

            if (inString) {
                diagnostics.push(this.createDiagnostic(
                    document, i, stringStart, stringStart + 1,
                    '未闭合的双引号 — 字符串从该位置开始到行尾未找到闭合引号',
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }
    }

    /** Innovus 命令参数检查 + 相似命令建议 */
    private checkCommandArgs(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[],
        db: ReturnType<typeof getDB>,
        level: DiagnosticLevel
    ): void {
        const lines = text.split('\n');
        const allCommandNames = db.getCommandNames();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('#')) { continue; }

            // 跳过 TCL 内置命令
            const firstToken = line.split(/\s/)[0];
            if (TclDiagnosticsProvider.TCL_BUILTINS.has(firstToken)) {
                continue;
            }

            // 提取第一个词作为可能的命令名
            const firstWordMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (!firstWordMatch) { continue; }

            const cmdName = firstWordMatch[1];
            const cmdStartIdx = line.indexOf(cmdName);

            // === 已知命令：检查参数 ===
            if (db.isCommand(cmdName)) {
                const cmdInfo = db.get(cmdName);
                if (cmdInfo && cmdInfo.options) {
                    const parsedArgs = this.parseArguments(line);

                    // 检查重复参数（strict 级别）
                    if (level === 'strict') {
                        const flagCounts = new Map<string, number>();
                        for (const [flag] of parsedArgs) {
                            flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
                        }
                        for (const [flag, count] of flagCounts) {
                            if (count > 1) {
                                const flagIdx = line.lastIndexOf(flag);
                                diagnostics.push(this.createDiagnostic(
                                    document, i, flagIdx, flagIdx + flag.length,
                                    `参数 ${flag} 重复指定了 ${count} 次`,
                                    vscode.DiagnosticSeverity.Warning
                                ));
                            }
                        }
                    }

                    // 检查必需参数
                    for (const opt of cmdInfo.options) {
                        if (!opt.required) { continue; }

                        if (!parsedArgs.has(opt.name)) {
                            diagnostics.push(this.createDiagnostic(
                                document, i,
                                cmdStartIdx, cmdStartIdx + cmdName.length,
                                `缺少必需参数: ${opt.name} — ${opt.description}`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        } else if (opt.type !== 'flag' && !parsedArgs.get(opt.name)) {
                            const flagIdx = line.indexOf(opt.name);
                            diagnostics.push(this.createDiagnostic(
                                document, i,
                                flagIdx, flagIdx + opt.name.length,
                                `参数 ${opt.name} 需要值 (类型: ${opt.type})`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }

                    // strict 级别：参数值类型检查
                    if (level === 'strict') {
                        this.checkParamTypes(document, i, line, cmdInfo.options, parsedArgs, diagnostics);
                    }
                }
                continue;
            }

            // === 已知条目（模式变量）：跳过参数校验 ===
            if (db.isKnown(cmdName)) {
                continue;
            }

            // === strict 级别：未知命令 → 相似命令建议 ===
            if (level === 'strict' && cmdName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
                const similar = this.findSimilarCommands(cmdName, allCommandNames);
                if (similar.length > 0) {
                    const suggestions = similar.map(s => `\`${s}\``).join(', ');
                    diagnostics.push(this.createDiagnostic(
                        document, i,
                        cmdStartIdx, cmdStartIdx + cmdName.length,
                        `未知命令 "${cmdName}"。你是否想写: ${suggestions}？`,
                        vscode.DiagnosticSeverity.Information
                    ));
                }
            }
        }
    }

    /** strict 级别：参数值类型验证 */
    private checkParamTypes(
        document: vscode.TextDocument,
        lineIdx: number,
        line: string,
        options: import('./commands').CmdOption[],
        parsedArgs: Map<string, string | null>,
        diagnostics: vscode.Diagnostic[]
    ): void {
        for (const opt of options) {
            const value = parsedArgs.get(opt.name);
            if (value === null || value === undefined) { continue; }

            // 检查类型匹配
            switch (opt.type) {
                case 'int':
                    if (!/^-?\d+$/.test(value)) {
                        const idx = line.indexOf(value);
                        if (idx >= 0) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx, idx, idx + value.length,
                                `${opt.name} 期望整数类型，但得到 "${value}"`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                    break;
                case 'float':
                    if (!/^-?\d+\.?\d*$/.test(value)) {
                        const idx = line.indexOf(value);
                        if (idx >= 0) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx, idx, idx + value.length,
                                `${opt.name} 期望浮点数类型，但得到 "${value}"`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                    break;
                case 'point':
                    if (!/^\{?\s*-?\d+\.?\d*\s+-?\d+\.?\d*\s*\}?$/.test(value)) {
                        const idx = line.indexOf(value);
                        if (idx >= 0) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx, idx, idx + value.length,
                                `${opt.name} 期望坐标类型 (如 "{x y}")，但得到 "${value}"`,
                                vscode.DiagnosticSeverity.Information
                            ));
                        }
                    }
                    break;
            }
        }
    }

    /**
     * 解析命令行参数，返回 Map<flagName, value | null>
     * flag 类型值为 null（表示存在），非 flag 类型值为跟随的字符串或 null（缺失值）
     */
    private parseArguments(line: string): Map<string, string | null> {
        const args = new Map<string, string | null>();
        const tokens = line.split(/\s+/);
        // 跳过第一个 token（命令名）
        for (let idx = 1; idx < tokens.length; idx++) {
            const token = tokens[idx];
            if (token.startsWith('-')) {
                // 去掉可能的尾随逗号/分号
                const cleanFlag = token.replace(/[,;]$/, '');
                // 查看下一个 token 是否为值（非 - 开头）
                if (idx + 1 < tokens.length && !tokens[idx + 1].startsWith('-')) {
                    let nextToken = tokens[idx + 1];
                    // 去掉尾随标点
                    nextToken = nextToken.replace(/[,;]$/, '');
                    // 去掉首尾花括号/引号（TCL 列表语法）
                    nextToken = nextToken.replace(/^\{/, '').replace(/\}$/, '');
                    args.set(cleanFlag, nextToken);
                    idx++; // 跳过值 token
                } else {
                    args.set(cleanFlag, null);
                }
            }
        }
        return args;
    }

    /** 使用编辑距离查找相似命令 */
    private findSimilarCommands(target: string, candidates: string[]): string[] {
        const lower = target.toLowerCase();
        const scored: { name: string; score: number }[] = [];

        // 前缀匹配优先
        for (const name of candidates) {
            if (name.toLowerCase().startsWith(lower)) {
                scored.push({ name, score: 0 });
                if (scored.length >= 3) { break; }
            }
        }

        // 包含匹配
        if (scored.length < 3) {
            for (const name of candidates) {
                if (name.toLowerCase().includes(lower) && !scored.some(s => s.name === name)) {
                    scored.push({ name, score: 1 });
                    if (scored.length >= 3) { break; }
                }
            }
        }

        // 编辑距离 ≤ 3
        if (scored.length < 3) {
            for (const name of candidates) {
                const dist = levenshtein(lower, name.toLowerCase());
                if (dist <= 3 && dist > 0 && !scored.some(s => s.name === name)) {
                    scored.push({ name, score: dist + 2 });
                    if (scored.length >= 3) { break; }
                }
            }
        }

        return scored.sort((a, b) => a.score - b.score).slice(0, 3).map(s => s.name);
    }

    private createDiagnostic(
        document: vscode.TextDocument,
        line: number,
        startChar: number,
        endChar: number,
        message: string,
        severity: vscode.DiagnosticSeverity
    ): vscode.Diagnostic {
        const range = new vscode.Range(line, startChar, line, endChar);
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'Innovus TCL';
        return diagnostic;
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}

/** 编辑距离算法 */
function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) { return n; }
    if (n === 0) { return m; }

    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                curr[j] = prev[j - 1];
            } else {
                curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
            }
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}
