/**
 * Hover Provider - 鼠标悬浮时显示 Innovus 命令/变量的帮助
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
        const cmdInfo = db.get(word);
        if (!cmdInfo) { return null; }

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // --- 标题 + 类型标签 ---
        if (cmdInfo.is_cmd) {
            markdown.appendMarkdown(`## \`${escapeMd(cmdInfo.command)}\` \`命令\`\n\n`);
        } else {
            markdown.appendMarkdown(`## \`${escapeMd(cmdInfo.command)}\` \`⚙️ 模式/变量\`\n\n`);
        }

        // --- 摘要 ---
        if (cmdInfo.summary) {
            markdown.appendMarkdown(`**${cmdInfo.summary}**\n\n`);
        }

        // --- 模式变量的使用说明 ---
        if (!cmdInfo.is_cmd) {
            markdown.appendMarkdown('---\n\n');
            markdown.appendMarkdown('> 💡 这是一个**模式设置变量**，通过以下方式使用：\n\n');
            markdown.appendCodeblock(`set ${cmdInfo.command}  ;# 启用/查看\nset ${cmdInfo.command} <value>  ;# 设置值`, 'tcl');
            markdown.appendMarkdown('\n');
        }

        // --- 语法 ---
        if (cmdInfo.usage) {
            markdown.appendMarkdown('### 语法\n\n');
            markdown.appendCodeblock(cmdInfo.usage, 'tcl');
            markdown.appendMarkdown('\n');
        }

        // --- 描述 ---
        if (cmdInfo.description && cmdInfo.description !== cmdInfo.summary) {
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
