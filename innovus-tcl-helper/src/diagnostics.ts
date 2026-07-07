/**
 * Diagnostics Provider - TCL 语法静态检查 + Innovus 命令参数校验
 *
 * 检查项:
 * 1. TCL 基础语法: 括号匹配、引号匹配、注释中的括号
 * 2. Innovus 命令: 已知命令拼写检查、必需参数检查
 */

import * as vscode from 'vscode';
import { getDB } from './commands';

export class TclDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('innovus-tcl');
    }

    /** 对整个文档进行诊断 */
    updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'tcl') { return; }

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const db = getDB();

        // 1. 括号匹配检查
        this.checkBrackets(document, text, diagnostics);

        // 2. 引号匹配检查
        this.checkQuotes(document, text, diagnostics);

        // 3. 命令参数检查（每行分析）
        this.checkCommandArgs(document, text, diagnostics, db);

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /** 括号匹配检查 - 适配 TCL 的 [] {} 语法 */
    private checkBrackets(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[]
    ): void {
        // TCL 中 {} 是特殊的（类似单引号），但作为代码块时仍需匹配
        // 简单策略：只检查非注释、非字符串中的括号
        const lines = text.split('\n');
        let braceDepth = 0;
        let bracketDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // 跳过纯注释行
            if (line.trimStart().startsWith('#')) { continue; }

            // 简单的括号计数（不处理转义和字符串内括号）
            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                // 跳过注释
                if (ch === '#' && (j === 0 || line[j - 1] !== '\\')) {
                    break; // 行内注释，跳过剩余
                }
                if (ch === '[') { bracketDepth++; }
                if (ch === ']') { bracketDepth--; }
                if (ch === '{') { braceDepth++; }
                if (ch === '}') { braceDepth--; }

                if (bracketDepth < 0) {
                    diagnostics.push(this.createDiagnostic(
                        document, i, j, j + 1,
                        '多余的右方括号 "]"',
                        vscode.DiagnosticSeverity.Error
                    ));
                    bracketDepth = 0;
                }
                if (braceDepth < 0) {
                    diagnostics.push(this.createDiagnostic(
                        document, i, j, j + 1,
                        '多余的右花括号 "}"',
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
                `缺少 ${bracketDepth} 个右方括号 "]"`,
                vscode.DiagnosticSeverity.Error
            ));
        }
        if (braceDepth > 0) {
            const lastLine = lines.length - 1;
            diagnostics.push(this.createDiagnostic(
                document, lastLine, 0, 1,
                `缺少 ${braceDepth} 个右花括号 "}"`,
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
                    '未闭合的双引号',
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }
    }

    /** Innovus 命令参数检查 */
    private checkCommandArgs(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[],
        db: ReturnType<typeof getDB>
    ): void {
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('#')) { continue; }

            // 跳过 TCL 内置命令
            const firstToken = line.split(/\s/)[0];
            if (/^(if|else|for|foreach|while|set|puts|proc|return|source|eval|expr|switch|catch|error|uplevel|upvar|global|variable|namespace|package|array|list|lindex|llength|lappend|concat|split|join|string|regexp|regsub|open|close|read|write|gets|file|cd|pwd|exec|after|vwait|bind|trace|rename|interp|clock|info|scan|format|binary|encoding|fconfigure|socket)$/.test(firstToken)) {
                continue;
            }

            // 提取第一个词作为可能的命令名
            const firstWordMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (!firstWordMatch) { continue; }

            const cmdName = firstWordMatch[1];

            // 检查是否为已知命令
            if (db.isCommand(cmdName)) {
                const cmdInfo = db.get(cmdName);
                if (cmdInfo && cmdInfo.options) {
                    // 解析命令行中的参数
                    const parsedArgs = this.parseArguments(line);

                    // 检查必需参数
                    for (const opt of cmdInfo.options) {
                        if (!opt.required) { continue; }

                        if (!parsedArgs.has(opt.name)) {
                            // 必需参数缺失
                            const msg = `缺少必需参数: ${opt.name} — ${opt.description}`;
                            diagnostics.push(this.createDiagnostic(
                                document, i,
                                line.indexOf(cmdName),
                                line.indexOf(cmdName) + cmdName.length,
                                msg,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        } else if (opt.type !== 'flag' && !parsedArgs.get(opt.name)) {
                            // 非 flag 类型参数存在但缺少值
                            const flagIdx = line.indexOf(opt.name);
                            const msg = `参数 ${opt.name} 需要值 (类型: ${opt.type})`;
                            diagnostics.push(this.createDiagnostic(
                                document, i,
                                flagIdx,
                                flagIdx + opt.name.length,
                                msg,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                }
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
                    const nextToken = tokens[idx + 1].replace(/[,;]$/, '');
                    args.set(cleanFlag, nextToken);
                    idx++; // 跳过值 token
                } else {
                    args.set(cleanFlag, null);
                }
            }
        }
        return args;
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
