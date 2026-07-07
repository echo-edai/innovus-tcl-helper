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

        const isZh = db.getLanguage() === 'zh';

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // --- 标题 + 类型标签 ---
        if (cmdInfo.is_cmd) {
            markdown.appendMarkdown(`## \`${escapeCode(cmdInfo.command)}\` \`${isZh ? '命令' : 'Command'}\`\n\n`);
        } else {
            markdown.appendMarkdown(`## \`${escapeCode(cmdInfo.command)}\` \`${isZh ? '⚙️ 模式/变量' : '⚙️ Mode/Variable'}\`\n\n`);
        }

        // --- 摘要 ---
        if (cmdInfo.summary) {
            markdown.appendMarkdown(`**${cmdInfo.summary}**\n\n`);
        }

        // --- 模式变量的使用说明 ---
        if (!cmdInfo.is_cmd) {
            markdown.appendMarkdown('---\n\n');
            if (isZh) {
                markdown.appendMarkdown('> 💡 这是一个**模式设置变量**，通过以下方式使用：\n\n');
            } else {
                markdown.appendMarkdown('> 💡 This is a **mode/variable setting**, use as follows:\n\n');
            }
            markdown.appendCodeblock(`set ${cmdInfo.command}  ;# ${isZh ? '启用/查看' : 'enable/view'}\nset ${cmdInfo.command} <value>  ;# ${isZh ? '设置值' : 'set value'}`, 'tcl');
            markdown.appendMarkdown('\n');
        }

        // --- 语法 ---
        if (cmdInfo.usage) {
            markdown.appendMarkdown(`### ${isZh ? '语法' : 'Syntax'}\n\n`);
            markdown.appendCodeblock(cmdInfo.usage, 'tcl');
            markdown.appendMarkdown('\n');
        }

        // --- 描述 ---
        if (cmdInfo.description && cmdInfo.description !== cmdInfo.summary) {
            markdown.appendMarkdown(`### ${isZh ? '说明' : 'Description'}\n\n`);
            markdown.appendMarkdown(cmdInfo.description + '\n\n');
        }

        // --- 参数 ---
        if (cmdInfo.options && cmdInfo.options.length > 0) {
            markdown.appendMarkdown(`### ${isZh ? '参数' : 'Options'}\n\n`);
            if (isZh) {
                markdown.appendMarkdown('| 参数 | 必需 | 类型 | 说明 |\n');
                markdown.appendMarkdown('|------|------|------|------|\n');
            } else {
                markdown.appendMarkdown('| Option | Required | Type | Description |\n');
                markdown.appendMarkdown('|--------|----------|------|-------------|\n');
            }
            for (const opt of cmdInfo.options) {
                const required = opt.required ? '✅' : '';
                const desc = escapeMd(opt.description).replace(/\n/g, ' ');
                markdown.appendMarkdown(`| \`${escapeCode(opt.name)}\` | ${required} | \`${escapeCode(opt.type)}\` | ${desc} |\n`);
            }
        }

        return new vscode.Hover(markdown, wordRange);
    }
}

/** 转义 Markdown 特殊字符 */
function escapeMd(text: string): string {
    return text.replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1');
}

/** 转义代码块（反引号）内的特殊字符 — 只需转义反引号本身 */
function escapeCode(text: string): string {
    return text.replace(/`/g, '\\`');
}
