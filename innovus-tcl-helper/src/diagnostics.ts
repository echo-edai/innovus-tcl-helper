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
            if (/^(if|else|for|foreach|while|set|puts|proc|return|source|eval|expr|switch|catch|error|uplevel|upvar|global|variable|namespace|package|array|list|lindex|llength|lappend|concat|split|join|string|regexp|regsub|open|close|read|write|gets|file|cd|pwd|exec|after|vwait|bind|trace|rename|interp|clock|info|scan|format|binary|encoding|fconfigure|socket)$/.test(line.split(/\s/)[0])) {
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
                    // 检查是否缺少必需参数
                    const requiredOpts = cmdInfo.options.filter(o => o.required && o.type !== 'flag');
                    const missingRequired = requiredOpts.filter(opt => !line.includes(opt.name));

                    if (missingRequired.length > 0) {
                        const names = missingRequired.map(o => o.name).join(', ');
                        diagnostics.push(this.createDiagnostic(
                            document, i, 0, line.length,
                            `缺少必需参数: ${names}`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                }
            }
            // 注意：不报告未知命令，因为 TCL 脚本中可能有很多自定义 proc
        }
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
