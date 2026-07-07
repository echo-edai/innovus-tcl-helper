/**
 * Hover Provider - 鼠标悬浮时显示 Innovus 命令的中文帮助
 */

import * as vscode from 'vscode';
import { getDB, CmdInfo, CmdOption } from './commands';

export class InnovusHoverProvider implements vscode.HoverProvider {

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {

        const db = getDB();
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) { return null; }

        const word = document.getText(wordRange);

        // 检查是否是已知的 Innovus 命令
        const cmdInfo = db.get(word);
        if (!cmdInfo) { return null; }

        // 构建 Markdown 悬停内容
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // --- 标题 ---
        markdown.appendMarkdown(`## \`${escapeMd(cmdInfo.command)}\`\n\n`);

        // --- 摘要 ---
        if (cmdInfo.summary) {
            markdown.appendMarkdown(`**${cmdInfo.summary}**\n\n`);
        }

        // --- 语法 ---
        if (cmdInfo.usage) {
            markdown.appendMarkdown('### 语法\n\n');
            markdown.appendCodeblock(cmdInfo.usage, 'tcl');
            markdown.appendMarkdown('\n');
        }

        // --- 描述 ---
        if (cmdInfo.description) {
            markdown.appendMarkdown('### 说明\n\n');
            markdown.appendMarkdown(cmdInfo.description + '\n\n');
        }

        // --- 参数 ---
        if (cmdInfo.options && cmdInfo.options.length > 0) {
            markdown.appendMarkdown('### 参数\n\n');
            markdown.appendMarkdown('| 参数 | 必需 | 类型 | 说明 |\n');
            markdown.appendMarkdown('|------|------|------|------|\n');
            for (const opt of cmdInfo.options) {
                const required = opt.required ? '✅' : '';
                const desc = escapeMd(opt.description).replace(/\n/g, ' ');
                markdown.appendMarkdown(`| \`${escapeMd(opt.name)}\` | ${required} | \`${escapeMd(opt.type)}\` | ${desc} |\n`);
            }
        }

        return new vscode.Hover(markdown, wordRange);
    }
}

/** 转义 Markdown 特殊字符 */
function escapeMd(text: string): string {
    return text.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1');
}
