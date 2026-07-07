/**
 * Definition Provider — F12/Ctrl+Click 跳转到命令帮助
 *
 * 支持两种显示风格（通过 innovus-tcl.helpStyle 配置）:
 *   "webview" — Webview 富文本面板（教育化排版）
 *   "plain"   — 虚拟纯文本文档（类 man page）
 */

import * as vscode from 'vscode';
import { getDB, CmdInfo, CmdOption } from './commands';

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
//  Definition Provider — 根据 helpStyle 配置路由
// ════════════════════════════════════════════════════════════════

export class InnovusDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private context: vscode.ExtensionContext) { }

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        const db = getDB();
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) { return null; }

        const word = document.getText(wordRange);
        const info = db.get(word);
        if (!info) { return null; }

        const style = getHelpStyle();

        if (style === 'webview') {
            // Webview 模式 → 返回虚拟 URI（带 mode 标记），
            // 由 onDidOpenTextDocument 监听器拦截并打开 Webview
            const uri = vscode.Uri.parse(`${HELP_SCHEME}://help/${word}?mode=webview`);
            return new vscode.Location(uri, new vscode.Position(0, 0));
        }

        // 纯文本模式 → 返回虚拟文档 URI
        const uri = vscode.Uri.parse(`${HELP_SCHEME}://help/${word}`);
        return new vscode.Location(uri, new vscode.Position(0, 0));
    }
}

/**
 * 由 extension.ts 的 onDidOpenTextDocument 调用。
 * 当检测到 webview 模式的虚拟文档被打开时，关闭文本编辑器并打开 Webview 面板。
 *
 * 注意: Ctrl+悬停时 VS Code 会触发 peek definition 预览，同样会打开虚拟文档。
 * 通过 200ms 延迟 + 检查文档是否仍活跃来区分「预览」和「真正点击」:
 *   - 预览 → 文档在 200ms 内关闭 → 不触发 Webview
 *   - 点击 → 文档保持打开 → 触发 Webview
 */
export function handleWebviewHelpOpen(doc: vscode.TextDocument, context: vscode.ExtensionContext): void {
    if (doc.uri.scheme !== HELP_SCHEME) { return; }

    const query = doc.uri.query;
    if (query !== 'mode=webview') { return; } // 纯文本模式，不拦截

    const cmdName = doc.uri.path.replace(/^\//, '');
    const db = getDB();
    const info = db.get(cmdName);
    if (!info) { return; }

    const docUri = doc.uri.toString();

    // 延迟 200ms，跳过 peek 预览
    setTimeout(() => {
        // 检查文档是否仍然打开（预览会被 VS Code 自动关闭）
        const stillOpen = vscode.workspace.textDocuments.some(
            d => d.uri.toString() === docUri
        );
        if (!stillOpen) { return; }

        // 真正点击 → 关闭虚拟文档，打开 Webview
        closeVirtualDoc(doc);
        HelpPanelManager.show(context, info);
    }, 200);
}

/** 关闭指定的虚拟文档编辑器标签页 */
function closeVirtualDoc(doc: vscode.TextDocument): void {
    // 找到该文档对应的 tab 并关闭
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const input = tab.input as { uri?: vscode.Uri } | undefined;
            if (input?.uri?.toString() === doc.uri.toString()) {
                vscode.window.tabGroups.close(tab);
                return;
            }
        }
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
