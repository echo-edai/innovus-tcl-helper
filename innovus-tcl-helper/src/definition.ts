/**
 * Definition Provider — F12/Ctrl+Click 跳转到命令的完整帮助文档
 *
 * 使用虚拟文档（TextDocumentContentProvider）展示格式化的帮助页
 */

import * as vscode from 'vscode';
import { getDB, CmdInfo } from './commands';

const HELP_SCHEME = 'innovus-tcl-help';

/** 虚拟帮助文档的内容提供者 */
export class InnovusHelpContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        const cmdName = uri.path.replace(/^\//, '');
        const db = getDB();
        const info = db.get(cmdName);
        if (!info) {
            return `Command "${cmdName}" not found.\n`;
        }
        return this.formatHelp(info);
    }

    private formatHelp(info: CmdInfo): string {
        const db = getDB();
        const isZh = db.getLanguage() === 'zh';
        const lines: string[] = [];

        // ── 标题 ──
        const sep = '═'.repeat(72);
        lines.push(sep);
        lines.push(`  ${info.command}`);
        if (info.summary) {
            lines.push(`  ${info.summary}`);
        }
        lines.push(sep);
        lines.push('');

        // ── 语法 ──
        lines.push(isZh ? '▎语法' : '▎SYNOPSIS');
        lines.push('  ' + (info.usage || info.command));
        lines.push('');

        // ── 说明 ──
        if (info.description && info.description !== info.summary) {
            lines.push(isZh ? '▎说明' : '▎DESCRIPTION');
            // 按宽度折行
            for (const wrapped of wrapText(info.description, 68)) {
                lines.push('  ' + wrapped);
            }
            lines.push('');
        }

        // ── 参数 ──
        if (info.options && info.options.length > 0) {
            lines.push(isZh ? '▎参数' : '▎OPTIONS');
            lines.push('');
            for (const opt of info.options) {
                const reqLabel = opt.required
                    ? (isZh ? ' [必需]' : ' [Required]')
                    : (isZh ? ' [可选]' : ' [Optional]');
                lines.push(`  ${opt.name}${reqLabel}`);
                lines.push(`      类型: ${opt.type}`);
                for (const wrapped of wrapText(opt.description, 64)) {
                    lines.push(`      ${wrapped}`);
                }
                lines.push('');
            }
        }

        // ── 页脚 ──
        lines.push('─'.repeat(72));
        lines.push(isZh
            ? '  Innovus TCL Helper — 自动生成  |  F12/Ctrl+Click 跳转'
            : '  Innovus TCL Helper — Auto-generated  |  F12/Ctrl+Click to navigate');
        lines.push('');

        return lines.join('\n');
    }
}

/** Definition Provider: 在命令名上按 F12 或 Ctrl+Click 跳转到帮助文档 */
export class InnovusDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        const db = getDB();
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) { return null; }

        const word = document.getText(wordRange);
        if (!db.isKnown(word)) { return null; }

        const uri = vscode.Uri.parse(`${HELP_SCHEME}://help/${word}`);
        return new vscode.Location(uri, new vscode.Position(0, 0));
    }
}

/** 简单文本折行 */
function wrapText(text: string, maxWidth: number): string[] {
    const result: string[] = [];
    const words = text.split(/\s+/);
    let line = '';
    for (const word of words) {
        if (line.length + word.length + 1 > maxWidth && line.length > 0) {
            result.push(line);
            line = word;
        } else {
            line = line ? line + ' ' + word : word;
        }
    }
    if (line) { result.push(line); }
    return result.length > 0 ? result : [text];
}
