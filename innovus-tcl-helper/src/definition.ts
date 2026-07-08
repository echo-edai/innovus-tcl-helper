/**
 * Definition Provider — F12/Ctrl+Click 跳转到命令帮助 / 变量定义
 *
 * 支持两种跳转目标:
 *   - Innovus 命令名 → 命令帮助文档（Webview 或纯文本）
 *   - $varName 变量引用 → 变量定义位置（set / foreach / proc 参数）
 *
 * 帮助显示风格（通过 innovus-tcl.helpStyle 配置）:
 *   "webview" — Webview 富文本面板（教育化排版）
 *   "plain"   — 虚拟纯文本文档（类 man page）
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getDB, CmdInfo, CmdOption } from './commands';
import { TclLintProvider } from './lint';

const HELP_SCHEME = 'innovus-tcl-help';

type HelpStyle = 'webview' | 'plain';

function getHelpStyle(): HelpStyle {
    return vscode.workspace.getConfiguration('innovus-tcl')
        .get<string>('helpStyle', 'webview') as HelpStyle;
}

// ════════════════════════════════════════════════════════════════
//  Plain Text 模式（TextDocumentContentProvider）
// ════════════════════════════════════════════════════════════════

export class InnovusPlainHelpProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        const cmdName = uri.path.replace(/^\//, '');
        const db = getDB();
        const info = db.get(cmdName);
        if (!info) { return `Command "${cmdName}" not found.\n`; }
        return formatPlain(info);
    }
}

function formatPlain(info: CmdInfo): string {
    const db = getDB();
    const isZh = db.getLanguage() === 'zh';
    const lines: string[] = [];
    const sep = '═'.repeat(72);

    lines.push(sep);
    lines.push(`  ${info.command}`);
    if (info.summary) { lines.push(`  ${info.summary}`); }
    lines.push(sep);
    lines.push('');

    lines.push(isZh ? '▎语法' : '▎SYNOPSIS');
    lines.push('  ' + (info.usage || info.command));
    lines.push('');

    if (info.description && info.description !== info.summary) {
        lines.push(isZh ? '▎说明' : '▎DESCRIPTION');
        for (const w of wrapText(info.description, 68)) { lines.push('  ' + w); }
        lines.push('');
    }

    if (info.options && info.options.length > 0) {
        lines.push(isZh ? '▎参数' : '▎OPTIONS');
        lines.push('');
        for (const opt of info.options) {
            const req = opt.required
                ? (isZh ? ' [必需]' : ' [Required]')
                : (isZh ? ' [可选]' : ' [Optional]');
            lines.push(`  ${opt.name}${req}`);
            lines.push(`      类型: ${opt.type}`);
            for (const w of wrapText(opt.description, 64)) { lines.push('      ' + w); }
            lines.push('');
        }
    }

    lines.push('─'.repeat(72));
    lines.push(isZh ? '  Innovus TCL Helper — 纯文本模式' : '  Innovus TCL Helper — Plain Text Mode');

    return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════
//  Webview 模式（富文本教育面板）
// ════════════════════════════════════════════════════════════════

class HelpPanelManager {
    private static currentPanel: vscode.WebviewPanel | undefined;

    static show(context: vscode.ExtensionContext, info: CmdInfo): void {
        const db = getDB();
        const isZh = db.getLanguage() === 'zh';
        const title = `${info.command} — ${isZh ? '帮助' : 'Help'}`;

        // 查找相关命令
        const related = findRelatedCommands(info.command, db);

        const html = buildHtml(info, isZh, related);

        if (this.currentPanel) {
            this.currentPanel.title = title;
            this.currentPanel.webview.html = html;
            this.currentPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            this.currentPanel = vscode.window.createWebviewPanel(
                'innovusCommandHelp',
                title,
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                { enableScripts: false, retainContextWhenHidden: true }
            );
            this.currentPanel.webview.html = html;
            this.currentPanel.onDidDispose(() => {
                this.currentPanel = undefined;
            }, null, context.subscriptions);
        }
    }
}

/** 查找前缀相似的相关命令（最多 8 个） */
function findRelatedCommands(cmdName: string, db: ReturnType<typeof getDB>): CmdInfo[] {
    const parts = cmdName.split('_');
    if (parts.length < 2) { return []; }

    // 取前两个前缀段作为关键词
    const prefix = parts.slice(0, 2).join('_');
    const allNames = db.getCommandNames();
    const related: CmdInfo[] = [];

    for (const name of allNames) {
        if (name === cmdName) { continue; }
        if (name.startsWith(prefix)) {
            const info = db.get(name);
            if (info && info.is_cmd !== false) {
                related.push(info);
                if (related.length >= 8) { break; }
            }
        }
    }
    return related;
}

/** 生成参数分析文本（中英文） */
function analyzeOptions(options: CmdOption[], isZh: boolean): string {
    if (!options || options.length === 0) { return ''; }

    const required = options.filter(o => o.required);
    const flags = options.filter(o => o.type === 'flag');
    const valued = options.filter(o => o.type !== 'flag');
    const enumOpts = options.filter(o => o.type === 'enum');

    const parts: string[] = [];

    if (required.length > 0) {
        const names = required.map(o => `<code>${escapeHtml(o.name)}</code>`).join(', ');
        parts.push(isZh
            ? `⚠️ 该命令有 <strong>${required.length} 个必需参数</strong>：${names}。执行前请确保已提供这些参数。`
            : `⚠️ This command has <strong>${required.length} required parameter(s)</strong>: ${names}. Make sure to provide them before execution.`);
    } else {
        parts.push(isZh
            ? `✅ 所有参数均为可选，可直接执行 <code>${escapeHtml(options[0]?.name ? '' : '')}</code>。`
            : `✅ All parameters are optional.`);
    }

    if (flags.length > 0 && valued.length > 0) {
        parts.push(isZh
            ? `💡 ${flags.length} 个开关参数（无需值）+ ${valued.length} 个赋值参数（需指定值）。`
            : `💡 ${flags.length} flag(s) (no value) + ${valued.length} value parameter(s) (needs value).`);
    }

    if (enumOpts.length > 0) {
        const names = enumOpts.map(o => `<code>${escapeHtml(o.name)}</code>`).join(', ');
        parts.push(isZh
            ? `🔢 ${names} 为枚举类型，有预设的可选值。`
            : `🔢 ${names} are enum types with preset choices.`);
    }

    return parts.map(p => `<p class="analysis-item">${p}</p>`).join('\n');
}

// ---- HTML 模板 ----

function buildHtml(info: CmdInfo, isZh: boolean, related: CmdInfo[]): string {
    const analysis = analyzeOptions(info.options, isZh);

    return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(info.command)} — ${isZh ? '帮助' : 'Help'}</title>
<style>${styles}</style>
</head>
<body>

<!-- 标题区 -->
<div class="header">
    <h1><code>${escapeHtml(info.command)}</code></h1>
    <span class="badge">${info.is_cmd !== false ? (isZh ? '命令' : 'Command') : (isZh ? '模式/变量' : 'Mode/Variable')}</span>
    ${info.summary ? `<p class="summary">${escapeHtml(info.summary)}</p>` : ''}
</div>

<!-- 参数分析卡片 -->
${analysis ? `
<div class="card analysis">
    <div class="card-title">${isZh ? '📊 参数分析' : '📊 Parameter Analysis'}</div>
    ${analysis}
</div>` : ''}

<!-- 语法 -->
${info.usage ? `
<div class="section">
    <h2>${isZh ? '▎语法' : '▎SYNOPSIS'}</h2>
    <pre class="usage"><code>${escapeHtml(info.usage)}</code></pre>
</div>` : ''}

<!-- 说明 -->
${(info.description && info.description !== info.summary) ? `
<div class="section">
    <h2>${isZh ? '▎说明' : '▎DESCRIPTION'}</h2>
    <p class="desc">${escapeHtml(info.description)}</p>
</div>` : ''}

<!-- 参数表 -->
${(info.options && info.options.length > 0) ? `
<div class="section">
    <h2>${isZh ? '▎参数列表' : '▎OPTIONS'} <span class="count">(${info.options.length})</span></h2>
    <table class="opts">
        <thead>
            <tr>
                <th>${isZh ? '参数' : 'Option'}</th>
                <th>${isZh ? '类型' : 'Type'}</th>
                <th>${isZh ? '必需' : 'Required'}</th>
                <th>${isZh ? '说明' : 'Description'}</th>
            </tr>
        </thead>
        <tbody>
            ${info.options.map(opt => `
            <tr class="${opt.required ? 'row-required' : 'row-optional'}">
                <td><code class="opt-name">${escapeHtml(opt.name)}</code></td>
                <td><span class="type-tag">${escapeHtml(opt.type)}</span></td>
                <td>${opt.required
            ? `<span class="req-tag required">${isZh ? '必需' : 'Required'}</span>`
            : `<span class="req-tag optional">${isZh ? '可选' : 'Optional'}</span>`
        }</td>
                <td>${escapeHtml(opt.description)}</td>
            </tr>`).join('\n            ')}
        </tbody>
    </table>
</div>` : ''}

<!-- 相关命令 -->
${related.length > 0 ? `
<div class="section">
    <h2>${isZh ? '▎相关命令' : '▎RELATED COMMANDS'} <span class="count">(${related.length})</span></h2>
    <div class="related-grid">
        ${related.map(r => `
        <div class="related-item">
            <code class="related-cmd">${escapeHtml(r.command)}</code>
            <span class="related-summary">${escapeHtml(r.summary || '')}</span>
        </div>`).join('\n        ')}
    </div>
    <p class="hint">${isZh ? '💡 点击上方命令名可用 F12 跳转查看详情' : '💡 F12 on any command name above to view its help'}</p>
</div>` : ''}

<!-- 使用提示 -->
<div class="card tip">
    <div class="card-title">${isZh ? '💡 使用提示' : '💡 Tips'}</div>
    <ul>
        <li>${isZh ? '鼠标悬停命令名可查看快速摘要' : 'Hover over the command name for a quick summary'}</li>
        <li>${isZh ? '输入命令后会自动提示可用参数' : 'Auto-completion of parameters after typing the command'}</li>
        <li>${isZh ? '通过 Ctrl+Shift+P → "切换帮助显示风格" 可在 Webview/纯文本 间切换' : 'Ctrl+Shift+P → "Toggle Help Style" to switch Webview/Plain Text'}</li>
    </ul>
</div>

<!-- 页脚 -->
<div class="footer">
    <span>Innovus TCL Helper</span>
    <span>${isZh ? 'F12 / Ctrl+Click 打开帮助' : 'F12 / Ctrl+Click to open help'}</span>
</div>

</body>
</html>`;
}

// ---- CSS ----

const styles = /* css */ `
:root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --border: var(--vscode-panel-border, #3c3c3c);
    --accent: var(--vscode-textLink-foreground, #3794ff);
    --code-bg: var(--vscode-textCodeBlock-background, #1a1a1a);
    --warn: #e5a510;
    --ok: #89d185;
    --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, -apple-system, sans-serif);
    font-size: 14px;
    line-height: 1.65;
    padding: 24px 28px;
    max-width: 880px;
}

/* 标题区 */
.header {
    margin-bottom: 24px;
    padding-bottom: 18px;
    border-bottom: 2px solid var(--border);
}
.header h1 { font-size: 22px; font-weight: 700; display: inline; margin-right: 12px; }
.header h1 code { font-size: 22px; color: var(--accent); background: none; padding: 0; }
.badge {
    display: inline-block; background: var(--code-bg); border: 1px solid var(--border);
    border-radius: 4px; padding: 2px 10px; font-size: 12px; vertical-align: middle;
}
.summary { margin-top: 10px; opacity: 0.85; font-size: 15px; }

/* 卡片 */
.card {
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px 20px; margin-bottom: 20px;
}
.card-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
.analysis p.analysis-item { margin-bottom: 6px; font-size: 13px; opacity: 0.9; }
.analysis code { font-size: 12px; }

.tip ul { padding-left: 20px; }
.tip li { font-size: 13px; opacity: 0.82; margin-bottom: 4px; }

/* 章节 */
.section { margin-bottom: 24px; }
.section h2 { font-size: 16px; font-weight: 600; margin-bottom: 10px; color: var(--accent); }
.section .count { font-size: 12px; opacity: 0.5; font-weight: 400; }
.section .desc { opacity: 0.9; }
.section .hint { font-size: 12px; opacity: 0.55; margin-top: 10px; }

/* 语法 */
.usage {
    background: var(--code-bg); border: 1px solid var(--border);
    border-radius: 6px; padding: 14px 18px; overflow-x: auto;
    font-family: var(--vscode-editor-font-family, 'Menlo', monospace);
    font-size: 13px; line-height: 1.55;
}
.usage code { color: var(--fg); }

/* 参数表格 */
.opts { width: 100%; border-collapse: collapse; font-size: 13px; }
.opts th {
    text-align: left; padding: 8px 12px; border-bottom: 2px solid var(--border);
    font-weight: 600; opacity: 0.8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
}
.opts td { padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
.opts tbody tr:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04)); }
.row-required td { background: rgba(229, 165, 16, 0.04); }
.opt-name { color: var(--accent); font-weight: 600; font-size: 13px; background: none; padding: 0; }
.type-tag {
    display: inline-block; background: var(--code-bg); border-radius: 3px;
    padding: 1px 8px; font-size: 11px; font-family: monospace;
}
.req-tag { display: inline-block; border-radius: 3px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
.req-tag.required { background: rgba(229, 165, 16, 0.15); color: var(--warn); }
.req-tag.optional { background: rgba(137, 209, 133, 0.12); color: var(--ok); }

/* 相关命令 */
.related-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.related-item {
    background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 6px; padding: 8px 12px;
}
.related-cmd { color: var(--accent); font-size: 12px; font-weight: 600; display: block; }
.related-summary { font-size: 11px; opacity: 0.65; display: block; margin-top: 2px; }

/* 页脚 */
.footer {
    margin-top: 32px; padding-top: 14px; border-top: 1px solid var(--border);
    font-size: 11px; opacity: 0.45; display: flex; justify-content: space-between;
}

/* 通用 */
code {
    font-family: var(--vscode-editor-font-family, 'Menlo', monospace);
    background: var(--code-bg); border-radius: 3px; padding: 1px 5px; font-size: 13px;
}
`;

// ════════════════════════════════════════════════════════════════
//  Definition Provider — 纯文本模式 F12/Ctrl+Click
// ════════════════════════════════════════════════════════════════

export class InnovusDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if (getHelpStyle() !== 'plain') { return null; }

        const db = getDB();
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) { return null; }

        const word = document.getText(wordRange);
        if (!db.isKnown(word)) { return null; }

        const uri = vscode.Uri.parse(`${HELP_SCHEME}://help/${word}`);
        return new vscode.Location(uri, new vscode.Position(0, 0));
    }
}

// ════════════════════════════════════════════════════════════════
//  Variable Definition Provider — F12/Ctrl+Click 跳转到 $varName 定义位置
// ════════════════════════════════════════════════════════════════

export class TclVariableDefinitionProvider implements vscode.DefinitionProvider {
    private lintProvider: TclLintProvider | null = null;

    /** 设置 Lint Provider 引用（由 extension.ts 注入） */
    setLintProvider(provider: TclLintProvider): void {
        this.lintProvider = provider;
    }

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if (!this.lintProvider) { return null; }
        const result = this.lintProvider.getLastResult();
        if (!result) { return null; }

        const line = document.lineAt(position.line).text;
        const col = position.character;

        // ── 检测 $varName 或 ${varName} ──
        const dollarRegex = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z0-9_]*)*)\}?/g;
        let match: RegExpExecArray | null;

        while ((match = dollarRegex.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            if (col >= start && col <= end) {
                const varName = match[2];

                // 查询变量定义
                const { allDefs } = this.lintProvider.getCompiler().queryVariable(
                    varName, result, document.uri.fsPath, position.line + 1
                );

                if (allDefs.length === 0) { return null; }

                // 返回所有定义位置（VS Code 会显示选择器或直接跳转）
                const locations: vscode.Location[] = [];
                for (const def of allDefs) {
                    const defUri = vscode.Uri.file(def.filePath);
                    const defPos = new vscode.Position(
                        Math.max(0, def.line - 1),
                        Math.max(0, def.column - 1)
                    );
                    locations.push(new vscode.Location(defUri, defPos));
                }

                // 如果只有一个定义，直接返回单个 Location
                if (locations.length === 1) {
                    return locations[0];
                }
                return locations;
            }
        }

        // ── 检测 set 命令中的变量名（光标在 set 的变量上时，跳转到该变量的引用） ──
        const setRegex = /\bset\s+([a-zA-Z_][a-zA-Z0-9_:]*)/g;
        while ((match = setRegex.exec(line)) !== null) {
            const varName = match[1];
            const start = match.index + 4;
            const end = start + varName.length;

            if (col >= start && col <= end) {
                const refs = result.variableRefs.filter(
                    r => r.name === varName
                );
                if (refs.length === 0) { return null; }
                const locations: vscode.Location[] = [];
                for (const ref of refs) {
                    const refUri = vscode.Uri.file(ref.filePath);
                    const refPos = new vscode.Position(
                        Math.max(0, ref.line - 1),
                        Math.max(0, ref.column - 1)
                    );
                    locations.push(new vscode.Location(refUri, refPos));
                }
                return locations.length === 1 ? locations[0] : locations;
            }
        }

        // ── 检测 proc 调用（光标在 proc 名上时，跳转到 proc 定义） ──
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (wordRange) {
            const word = document.getText(wordRange);
            // 在所有编译单元中查找匹配的 proc 定义
            for (const unit of result.units) {
                for (const proc of unit.procs) {
                    if (proc.procName === word) {
                        // 跳转到 proc 定义位置
                        const defUri = vscode.Uri.file(unit.filePath);
                        const defPos = new vscode.Position(
                            Math.max(0, proc.line - 1),
                            Math.max(0, proc.column - 1)
                        );
                        return new vscode.Location(defUri, defPos);
                    }
                }
            }
        }

        return null;
    }
}

// ════════════════════════════════════════════════════════════════
//  Document Link Provider — Ctrl+Click 入口（两种模式均生效）
//
//  关键: provideDocumentLinks 不做模式判断，始终返回链接。
//  模式切换时 VS Code 无缓存失效问题。命令回调动态判断行为。
// ════════════════════════════════════════════════════════════════

const HELP_CMD = 'innovus-tcl._showHelp';

export class InnovusDocumentLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentLink[]> {
        const db = getDB();
        const links: vscode.DocumentLink[] = [];
        const text = document.getText();
        const regex = /\b([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            const word = match[1];
            if (!db.isKnown(word)) { continue; }

            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + word.length);
            const range = new vscode.Range(startPos, endPos);

            const args = encodeURIComponent(JSON.stringify([word]));
            const cmdUri = vscode.Uri.parse(`command:${HELP_CMD}?${args}`);
            links.push(new vscode.DocumentLink(range, cmdUri));
        }

        return links;
    }
}

/**
 * Ctrl+Click 命令回调 — 根据当前模式决定行为:
 *   Webview → 打开 Webview 面板
 *   纯文本 → 打开虚拟文档
 */
export function showHelp(context: vscode.ExtensionContext, cmdName: string): void {
    const db = getDB();
    const info = db.get(cmdName);
    if (!info) { return; }

    if (getHelpStyle() === 'webview') {
        HelpPanelManager.show(context, info);
    } else {
        const uri = vscode.Uri.parse(`${HELP_SCHEME}://help/${cmdName}`);
        vscode.window.showTextDocument(uri, { preview: true, preserveFocus: false });
    }
}

// ---- 工具 ----

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

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
