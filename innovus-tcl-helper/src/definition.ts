/**
 * Definition Provider — F12/Ctrl+Click 跳转到命令的 Webview 帮助面板
 *
 * 使用 Webview Panel 展示格式化的 HTML 帮助页，风格类似 man page
 */

import * as vscode from 'vscode';
import { getDB, CmdInfo } from './commands';

/** 管理 Webview 帮助面板（单例复用） */
class HelpPanelManager {
    private static currentPanel: vscode.WebviewPanel | undefined;

    static show(context: vscode.ExtensionContext, info: CmdInfo): void {
        const db = getDB();
        const isZh = db.getLanguage() === 'zh';
        const title = `${info.command} — ${isZh ? '帮助' : 'Help'}`;

        if (this.currentPanel) {
            // 复用已有面板，更新内容
            this.currentPanel.title = title;
            this.currentPanel.webview.html = buildHtml(info, isZh);
            this.currentPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            // 创建新面板
            this.currentPanel = vscode.window.createWebviewPanel(
                'innovusCommandHelp',
                title,
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                {
                    enableScripts: false,
                    retainContextWhenHidden: true,
                }
            );

            this.currentPanel.webview.html = buildHtml(info, isZh);

            this.currentPanel.onDidDispose(() => {
                this.currentPanel = undefined;
            }, null, context.subscriptions);
        }
    }
}

// ---- HTML 模板 ----

function buildHtml(info: CmdInfo, isZh: boolean): string {
    return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(info.command)} — ${isZh ? '帮助' : 'Help'}</title>
<style>
${styles}
</style>
</head>
<body>

<!-- 标题区 -->
<div class="header">
    <h1><code>${escapeHtml(info.command)}</code></h1>
    <span class="badge">${info.is_cmd !== false ? (isZh ? '命令' : 'Command') : (isZh ? '模式/变量' : 'Mode/Variable')}</span>
    ${info.summary ? `<p class="summary">${escapeHtml(info.summary)}</p>` : ''}
</div>

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
    <h2>${isZh ? '▎参数' : '▎OPTIONS'}</h2>
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
            <tr class="${opt.required ? 'required' : 'optional'}">
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

<!-- 页脚 -->
<div class="footer">
    <span>Innovus TCL Helper</span>
    <span>${isZh ? 'F12 / Ctrl+Click 跳转' : 'F12 / Ctrl+Click to open'}</span>
</div>

</body>
</html>`;
}

// ---- CSS 样式 ----

const styles = /* css */ `
:root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --border: var(--vscode-panel-border, #3c3c3c);
    --accent: var(--vscode-textLink-foreground, #3794ff);
    --code-bg: var(--vscode-textCodeBlock-background, #1a1a1a);
    --warn: #e5a510;
    --ok: #89d185;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, -apple-system, sans-serif);
    font-size: 14px;
    line-height: 1.6;
    padding: 24px 28px;
    max-width: 860px;
}

/* 标题区 */
.header {
    margin-bottom: 28px;
    padding-bottom: 20px;
    border-bottom: 2px solid var(--border);
}
.header h1 {
    font-size: 22px;
    font-weight: 700;
    display: inline;
    margin-right: 12px;
}
.header h1 code {
    font-size: 22px;
    color: var(--accent);
    background: none;
    padding: 0;
}
.badge {
    display: inline-block;
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 10px;
    font-size: 12px;
    vertical-align: middle;
}
.summary {
    margin-top: 10px;
    color: var(--fg);
    opacity: 0.85;
    font-size: 15px;
}

/* 章节 */
.section {
    margin-bottom: 24px;
}
.section h2 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 10px;
    color: var(--accent);
}
.section .desc {
    opacity: 0.9;
}

/* 语法代码块 */
.usage {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 14px 18px;
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family, 'Menlo', monospace);
    font-size: 13px;
    line-height: 1.55;
}
.usage code {
    color: var(--fg);
}

/* 参数表格 */
.opts {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}
.opts th {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 2px solid var(--border);
    font-weight: 600;
    opacity: 0.8;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.opts td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
}
.opts tbody tr:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
}
.opt-name {
    color: var(--accent);
    font-weight: 600;
    font-size: 13px;
    background: none;
    padding: 0;
}
.type-tag {
    display: inline-block;
    background: var(--code-bg);
    border-radius: 3px;
    padding: 1px 8px;
    font-size: 11px;
    font-family: monospace;
}
.req-tag {
    display: inline-block;
    border-radius: 3px;
    padding: 1px 8px;
    font-size: 11px;
    font-weight: 600;
}
.req-tag.required {
    background: rgba(229, 165, 16, 0.15);
    color: var(--warn);
}
.req-tag.optional {
    background: rgba(137, 209, 133, 0.12);
    color: var(--ok);
}

/* 页脚 */
.footer {
    margin-top: 32px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    opacity: 0.5;
    display: flex;
    justify-content: space-between;
}

/* 代码通用 */
code {
    font-family: var(--vscode-editor-font-family, 'Menlo', monospace);
    background: var(--code-bg);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 13px;
}
`;

// ---- Definition Provider ----

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

        // 打开 Webview 帮助面板
        HelpPanelManager.show(this.context, info);

        // 返回 null，不跳转到其他位置
        return null;
    }
}

// ---- 工具函数 ----

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
