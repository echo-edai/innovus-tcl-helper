/**
 * Completion Provider - 输入时自动补全 Innovus 命令名及其参数
 */

import * as vscode from 'vscode';
import { getDB, CmdInfo } from './commands';

export class InnovusCompletionProvider implements vscode.CompletionItemProvider {

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {

        const db = getDB();
        const linePrefix = document.lineAt(position).text.substring(0, position.character);

        // 判断是否在输入命令名（行首或空白后，不在参数区）
        const isCommandPosition = this.isAtCommandStart(linePrefix);

        if (isCommandPosition) {
            // --- 命令名补全 ---
            const allNames = db.getCommandNames();
            const items: vscode.CompletionItem[] = [];
            for (const name of allNames) {
                const info = db.get(name);
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                item.detail = 'Innovus Command';
                item.documentation = new vscode.MarkdownString(
                    info ? `**${info.summary}**\n\n${info.description || ''}` : 'Innovus 命令'
                );
                // 排序：常用命令靠前
                item.sortText = '0' + name;
                items.push(item);
            }
            return items;
        }

        // --- 参数补全 ---
        // 查找当前行使用的命令
        const cmdName = this.extractCommandName(linePrefix);
        if (!cmdName) { return []; }

        const cmdInfo = db.get(cmdName);
        if (!cmdInfo || !cmdInfo.options) { return []; }

        // 收集已使用的参数名
        const usedFlags = this.extractUsedFlags(linePrefix);

        const items: vscode.CompletionItem[] = [];
        for (const opt of cmdInfo.options) {
            // 跳过已使用的 flag 类型参数
            if (opt.type === 'flag' && usedFlags.has(opt.name)) {
                continue;
            }

            const item = new vscode.CompletionItem(opt.name, vscode.CompletionItemKind.Property);
            item.detail = `Innovus: ${cmdName}`;
            item.documentation = new vscode.MarkdownString(
                `**${opt.name}**  \n${opt.description}  \n*类型: ${opt.type} | ${opt.required ? '必需' : '可选'}*`
            );

            // 排序：required 在前
            item.sortText = opt.required ? '0' : '1';
            item.insertText = opt.name + ' ';

            // 如果是枚举类型，提供选项
            if (opt.type === 'enum') {
                // 从描述中提取枚举值
                const enumMatch = opt.description.match(/\{([^}]+)\}/);
                if (enumMatch) {
                    item.insertText = opt.name + ' ';
                    item.documentation = new vscode.MarkdownString(
                        `**${opt.name}**  \n${opt.description}  \n*可选值: ${enumMatch[1]}*`
                    );
                }
            }

            items.push(item);
        }
        return items;
    }

    /** 判断光标位置是否在命令名输入位置 */
    private isAtCommandStart(line: string): boolean {
        // 去掉行首空白后的文本
        const trimmed = line.trimStart();
        if (trimmed.length === 0) { return true; }
        // 如果已经有一个完整的词（命令名），且有空格后，就不是命令位置
        // 简单判断：没有空格或者是刚空格完
        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx === -1) {
            // 还没空格，可能正在输入命令名
            // 如果以 - 开头，说明在输入参数
            return !trimmed.startsWith('-');
        }
        // 已有空格，检查光标是否在参数区
        const afterLastSpace = line.lastIndexOf(' ');
        const textAfterSpace = line.substring(afterLastSpace + 1);
        return textAfterSpace.startsWith('-');
    }

    /** 从行文本中提取命令名 */
    private extractCommandName(line: string): string | null {
        const trimmed = line.trimStart();
        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx === -1) { return null; }
        const cmdName = trimmed.substring(0, spaceIdx);
        // 验证是已知命令
        const db = getDB();
        if (db.isCommand(cmdName)) {
            return cmdName;
        }
        return null;
    }

    /** 提取行中已使用的 flag 参数 */
    private extractUsedFlags(line: string): Set<string> {
        const flags = new Set<string>();
        const regex = /(-\w+)/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(line)) !== null) {
            flags.add(match[1]);
        }
        return flags;
    }
}
