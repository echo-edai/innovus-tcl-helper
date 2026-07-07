/**
 * Semantic Tokens Provider — 为 Innovus 命令提供语义级语法高亮
 *
 * Token 类型:
 *   function  — Innovus 命令名（会显示为函数/命令色）
 *   parameter — 参数 flag（如 -help, -cell）
 *   variable  — 模式/变量名（非命令条目）
 */

import * as vscode from 'vscode';
import { getDB } from './commands';

const tokenTypes = ['function', 'parameter', 'variable'];
const tokenModifiers: string[] = [];

export class InnovusSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    private db = getDB();

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SemanticTokens> {
        const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
        const builder = new vscode.SemanticTokensBuilder(legend);
        const text = document.getText();
        const lines = text.split('\n');

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const trimmed = line.trimStart();
            if (!trimmed || trimmed.startsWith('#')) { continue; }

            // 提取第一个词作为可能的命令/变量名
            const firstWordMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (!firstWordMatch) { continue; }

            const word = firstWordMatch[1];
            const startChar = line.indexOf(word);

            const info = this.db.get(word);
            if (!info) { continue; }

            if (info.is_cmd !== false) {
                // Innovus 命令 → function 类型高亮
                builder.push(lineIdx, startChar, word.length, 0, 0);
            } else {
                // 模式/变量 → variable 类型高亮
                builder.push(lineIdx, startChar, word.length, 2, 0);
            }

            // 高亮该行的参数 flag（-xxx）
            const flagRegex = /(-\w+)/g;
            let match: RegExpExecArray | null;
            while ((match = flagRegex.exec(line)) !== null) {
                // 排除命令名之后的非 flag 内容
                const flagName = match[1];
                const flagStart = match.index;
                // 只标记已知参数
                const isKnownFlag = info.options?.some(o => o.name === flagName);
                if (isKnownFlag) {
                    builder.push(lineIdx, flagStart, flagName.length, 1, 0);
                }
            }
        }

        return builder.build();
    }

    getLegend(): vscode.SemanticTokensLegend {
        return new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
    }
}
