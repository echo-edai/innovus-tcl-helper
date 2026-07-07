/**
 * Innovus TCL Helper - VS Code 插件入口
 *
 * 功能:
 * 1. Hover 悬停显示 Innovus 命令文档（中/英文可切换）
 * 2. 命令名和参数自动补全
 * 3. TCL 基础语法静态检查 + Innovus 命令参数校验（3 级别）
 * 4. 多版本 Innovus 数据支持
 * 5. Copilot AI 工具集成（LM Tools）
 * 6. F12/Ctrl+Click 帮助文档跳转
 * 7. Semantic Tokens 语法高亮
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getDB, Language } from './commands';
import { InnovusHoverProvider } from './hover';
import { InnovusCompletionProvider } from './completion';
import { TclDiagnosticsProvider } from './diagnostics';
import { InnovusDefinitionProvider, InnovusPlainHelpProvider, InnovusDocumentLinkProvider, showHelp } from './definition';
import { InnovusSemanticTokensProvider } from './semantic';
import { registerAllTools, buildScriptContextForCommand } from './tools';

let diagnosticsProvider: TclDiagnosticsProvider | undefined;

/**
 * 根据配置值解析实际语言。
 * "auto" → 跟随 VS Code 界面语言（中文 → zh，其他 → en）
 */
function resolveLanguage(configLang: string): Language {
    if (configLang === 'auto') {
        // vscode.env.language 示例: "zh-cn", "zh-tw", "en", "ja", ...
        const vsLang = vscode.env.language.toLowerCase();
        return vsLang.startsWith('zh') ? 'zh' : 'en';
    }
    return configLang as Language;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('[Innovus TCL] 插件已激活');

    const config = vscode.workspace.getConfiguration('innovus-tcl');

    // 初始化命令数据库
    const db = getDB(context.extensionPath);

    // 读取语言设置（支持 auto 自动检测）
    const rawLang = config.get<string>('language', 'auto');
    const lang = resolveLanguage(rawLang);
    db.setLanguage(lang);

    // 读取版本设置
    const version = config.get<string>('version', '');
    if (version) {
        db.setVersion(version);
    }

    // 检查是否有自定义数据根路径
    const customRoot = config.get<string>('dataRoot');
    if (customRoot) {
        db.setDataRoot(customRoot);
    }

    // 兼容旧配置: innovus-tcl.dataPath
    const legacyPath = config.get<string>('dataPath');
    if (legacyPath) {
        db.setDataRoot(legacyPath);
    }

    db.load();

    const subs: vscode.Disposable[] = [];

    // 1. Hover Provider - 命令悬停提示
    if (config.get<boolean>('enableHover', true)) {
        subs.push(vscode.languages.registerHoverProvider(
            { language: 'tcl' },
            new InnovusHoverProvider()
        ));
    }

    // 2. Completion Provider - 命令/参数自动补全
    if (config.get<boolean>('enableCompletion', true)) {
        subs.push(vscode.languages.registerCompletionItemProvider(
            { language: 'tcl' },
            new InnovusCompletionProvider(),
            ' ', '-', '_'
        ));
    }

    // 3. Diagnostics - 语法与命令检查
    if (config.get<boolean>('enableDiagnostics', true)) {
        diagnosticsProvider = new TclDiagnosticsProvider();

        if (vscode.window.activeTextEditor) {
            diagnosticsProvider.updateDiagnostics(vscode.window.activeTextEditor.document);
        }

        subs.push(vscode.workspace.onDidSaveTextDocument((doc) => {
            diagnosticsProvider?.updateDiagnostics(doc);
        }));

        subs.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                diagnosticsProvider?.updateDiagnostics(editor.document);
            }
        }));
    }

    // 4a. Definition Provider — 纯文本模式 (F12 → 虚拟文档)
    const plainHelpProvider = new InnovusPlainHelpProvider();
    subs.push(vscode.workspace.registerTextDocumentContentProvider('innovus-tcl-help', plainHelpProvider));
    subs.push(vscode.languages.registerDefinitionProvider(
        { language: 'tcl' },
        new InnovusDefinitionProvider()
    ));

    // 4b. Document Link Provider — Ctrl+Click 入口（始终生效，模式在回调中判断）
    subs.push(vscode.languages.registerDocumentLinkProvider(
        { language: 'tcl' },
        new InnovusDocumentLinkProvider()
    ));

    // 4c. Ctrl+Click 回调命令 — 根据当前模式打开 Webview 或虚拟文档
    subs.push(vscode.commands.registerCommand('innovus-tcl._showHelp', (cmdName: string) => {
        showHelp(context, cmdName);
    }));

    // 5. Semantic Tokens - Innovus 命令/参数语法高亮
    const semanticProvider = new InnovusSemanticTokensProvider();
    subs.push(vscode.languages.registerDocumentSemanticTokensProvider(
        { language: 'tcl' },
        semanticProvider,
        semanticProvider.getLegend()
    ));

    // 6. Copilot AI 工具集成 — 注册 LM Tools
    if (config.get<boolean>('enableAITools', true)) {
        registerAllTools(context);
    }

    // 监听配置变更，切换语言/版本/AI工具时自动重载
    subs.push(vscode.workspace.onDidChangeConfiguration((e) => {
        const cfg = vscode.workspace.getConfiguration('innovus-tcl');

        if (e.affectsConfiguration('innovus-tcl.language')) {
            const rawLang = cfg.get<string>('language', 'auto');
            const newLang = resolveLanguage(rawLang);
            db.setLanguage(newLang);
            vscode.window.showInformationMessage(
                `Innovus TCL: 已切换为${newLang === 'zh' ? '中文' : 'English'} (${db.getCommandNames().length} 命令)`
            );
        }
        if (e.affectsConfiguration('innovus-tcl.dataRoot') || e.affectsConfiguration('innovus-tcl.version')) {
            const newRoot = cfg.get<string>('dataRoot', '');
            if (newRoot) { db.setDataRoot(newRoot); }
            const newVer = cfg.get<string>('version', '');
            if (newVer) { db.setVersion(newVer); }
            db.reload();
            vscode.window.showInformationMessage(
                `Innovus TCL: 已切换至版本 ${db.getVersion() || '(默认)'}，${db.getCommandNames().length} 个命令`
            );
        }
        if (e.affectsConfiguration('innovus-tcl.enableAITools')) {
            const aiEnabled = cfg.get<boolean>('enableAITools', true);
            if (aiEnabled) {
                vscode.window.showInformationMessage(
                    'Innovus TCL: Copilot AI 工具已启用。\n\n在 Copilot Chat 中，你可以:\n• 查询所有 Innovus 命令\n• 获取命令的详细语法和参数\n• 解析 TCL 脚本生成描述\n\n💡 请重新加载窗口以使 AI 工具生效。',
                    { modal: true }
                );
            }
        }
    }));

    // 注册命令：重新加载数据库
    subs.push(vscode.commands.registerCommand('innovus-tcl.reloadDB', () => {
        db.reload();
        vscode.window.showInformationMessage(
            `Innovus TCL: 已重新加载 ${db.getCommandNames().length} 个命令 (${db.getLanguage() === 'zh' ? '中文' : 'English'})`
        );
    }));

    // 注册命令：查看插件信息
    subs.push(vscode.commands.registerCommand('innovus-tcl.showHelp', () => {
        const stats = db.getStats();
        const langLabel = db.getLanguage() === 'zh' ? '中文' : 'English';
        const versionLabel = stats.version || '(默认)';
        const level = vscode.workspace.getConfiguration('innovus-tcl').get<string>('diagnosticLevel', 'standard');
        const levelLabels: Record<string, string> = {
            basic: '基础 (仅括号/引号)',
            standard: '标准 (+参数校验)',
            strict: '严格 (+类型验证 +相似建议)'
        };
        const msg = [
            `🚀 Innovus TCL Helper v0.3.0`,
            ``,
            `📦 已加载条目: ${stats.totalEntries} 个`,
            `   ├─ 命令: ${stats.commands} 个`,
            `   └─ 变量/模式: ${stats.variables} 个`,
            `🔢 Innovus 版本: ${versionLabel}`,
            `🌐 当前语言: ${langLabel}`,
            `🔍 悬停提示: ${config.get('enableHover') ? '✅' : '❌'}`,
            `✏️  自动补全: ${config.get('enableCompletion') ? '✅' : '❌'}`,
            `⚠️  静态检查: ${config.get('enableDiagnostics') ? '✅' : '❌'} (${levelLabels[level] || level})`,
            `🤖 AI 工具: ${config.get('enableAITools') ? '✅' : '❌'}`,
        ].join('\n');
        vscode.window.showInformationMessage(msg, { modal: true });
    }));

    // 注册命令：切换中/英文
    subs.push(vscode.commands.registerCommand('innovus-tcl.switchLanguage', async () => {
        const current = db.getLanguage();
        const newLang: Language = current === 'zh' ? 'en' : 'zh';
        const cfg = vscode.workspace.getConfiguration('innovus-tcl');
        await cfg.update('language', newLang, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
            `Innovus TCL: 已切换为${newLang === 'zh' ? '中文' : 'English'} (${db.getCommandNames().length} 命令)`
        );
    }));

    // 注册命令：切换帮助显示风格 (Webview ↔ 纯文本)
    subs.push(vscode.commands.registerCommand('innovus-tcl.toggleHelpStyle', async () => {
        const cfg = vscode.workspace.getConfiguration('innovus-tcl');
        const current = cfg.get<string>('helpStyle', 'webview');
        const next = current === 'webview' ? 'plain' : 'webview';
        await cfg.update('helpStyle', next, vscode.ConfigurationTarget.Global);
        const label = next === 'webview'
            ? (db.getLanguage() === 'zh' ? 'Webview 富文本面板' : 'Webview Rich Panel')
            : (db.getLanguage() === 'zh' ? '纯文本编辑器' : 'Plain Text Editor');
        vscode.window.showInformationMessage(`Innovus TCL: 帮助风格 → ${label}`);
    }));

    // 注册命令：切换 Innovus 版本
    subs.push(vscode.commands.registerCommand('innovus-tcl.switchVersion', async () => {
        const versions = db.getAvailableVersions();
        const currentVer = db.getVersion();
        const isZh = db.getLanguage() === 'zh';

        const items = versions.map(v => ({
            label: v.label,
            description: v.description,
            detail: (v.label === '(默认)' && !currentVer) || v.label === currentVer
                ? (isZh ? '● 当前使用' : '● Current')
                : ''
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: isZh ? '选择 Innovus 版本 (test=关闭高亮, 25.1=完整数据)' : 'Select Innovus version (test=no highlight, 25.1=full data)'
        });

        if (picked) {
            const cfg = vscode.workspace.getConfiguration('innovus-tcl');
            const newVer = picked.label === '(默认)' ? '' : picked.label;
            await cfg.update('version', newVer, vscode.ConfigurationTarget.Global);
        }
    }));

    // 注册命令：AI 分析当前 TCL 脚本
    subs.push(vscode.commands.registerCommand('innovus-tcl.analyzeScript', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'tcl') {
            vscode.window.showWarningMessage(
                db.getLanguage() === 'zh' ? '请先打开一个 TCL 文件。' : 'Please open a TCL file first.'
            );
            return;
        }

        const isZh = db.getLanguage() === 'zh';
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const mcpConfigPath = workspaceFolder
            ? path.join(workspaceFolder.uri.fsPath, '.vscode', 'mcp.json')
            : '';

        // 检查 MCP 是否已安装
        let mcpAvailable = false;
        if (mcpConfigPath && fs.existsSync(mcpConfigPath)) {
            try {
                const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
                if (mcpConfig.servers?.['innovus-tcl']) {
                    mcpAvailable = true;
                }
            } catch { /* ignore */ }
        }

        // 构建选项列表
        const options: vscode.QuickPickItem[] = [
            {
                label: '📋 ' + (isZh ? '拼接文档（本地查看）' : 'Doc Concatenation (Local View)'),
                description: isZh
                    ? '将所有命令的完整文档 + 参数对照表拼接为 Markdown，在新文档中展示'
                    : 'Concatenate all command docs + parameter comparison as Markdown in a new document'
            }
        ];

        if (mcpAvailable) {
            options.push({
                label: '🤖 ' + (isZh ? 'Copilot AI 分析 (MCP)' : 'Copilot AI Analysis (MCP)'),
                description: isZh
                    ? '将上下文传递给 Copilot Chat，由 AI 基于命令文档进行智能分析'
                    : 'Pass context to Copilot Chat for AI-powered analysis based on command docs'
            });
        } else {
            options.push({
                label: '🔧 ' + (isZh ? '一键安装 MCP 工具' : 'Install MCP Tools'),
                description: isZh
                    ? '自动配置 MCP 工具，之后可在 Copilot Chat 中让 AI 分析脚本'
                    : 'Auto-configure MCP tools for AI analysis in Copilot Chat'
            });
        }

        const choice = await vscode.window.showQuickPick(options, {
            placeHolder: isZh ? '选择分析方式' : 'Select analysis mode'
        });

        if (!choice) { return; }

        const content = editor.document.getText();
        const sourceLabel = editor.document.uri.fsPath || (isZh ? '当前脚本' : 'current script');

        if (choice.label.startsWith('📋')) {
            // 拼接文档模式
            const report = buildScriptContextForCommand(content, sourceLabel);
            const doc = await vscode.workspace.openTextDocument({
                content: report,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: true
            });
        } else if (choice.label.startsWith('🤖')) {
            // MCP 模式：生成上下文并引导用户到 Copilot Chat
            const report = buildScriptContextForCommand(content, sourceLabel);
            const doc = await vscode.workspace.openTextDocument({
                content: report,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: true
            });

            vscode.window.showInformationMessage(
                isZh
                    ? '已生成分析上下文。请在 Copilot Chat 中直接说："分析我当前打开的 TCL 脚本"，Copilot 会自动调用 MCP 工具进行 AI 分析。'
                    : 'Context generated. In Copilot Chat, say: "Analyze my current TCL script" — Copilot auto-calls MCP tools for AI analysis.',
                { modal: true }
            );
        } else {
            // 安装 MCP 工具
            await vscode.commands.executeCommand('innovus-tcl.installMcp');
        }
    }));

    // 注册命令：列出所有 Innovus 命令
    subs.push(vscode.commands.registerCommand('innovus-tcl.listCommands', async () => {
        const allNames = db.getCommandNames();
        const stats = db.getStats();
        const isZh = db.getLanguage() === 'zh';

        const searchTerm = await vscode.window.showInputBox({
            placeHolder: isZh ? '输入关键词过滤（留空显示全部）' : 'Enter keyword to filter (leave empty for all)',
            prompt: isZh
                ? `共 ${stats.commands} 个命令 + ${stats.variables} 个变量/模式`
                : `${stats.commands} commands + ${stats.variables} variables/modes total`
        });

        let filtered = allNames;
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            filtered = allNames.filter(name => name.toLowerCase().includes(lower));
        }

        const maxDisplay = 500;
        const displayNames = filtered.slice(0, maxDisplay);

        const items = displayNames.map(name => {
            const info = db.get(name);
            const isCmd = info?.is_cmd !== false;
            return {
                label: name,
                description: info?.summary || '',
                detail: isCmd
                    ? (isZh ? '命令' : 'Command')
                    : (isZh ? '变量/模式' : 'Variable/Mode')
            };
        });

        const picked = await vscode.window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: isZh
                ? `显示 ${displayNames.length} / ${filtered.length} 个条目`
                : `Showing ${displayNames.length} / ${filtered.length} items`
        });

        if (picked) {
            // 用户选择了一个命令，显示其帮助
            showHelp(context, picked.label);
        }
    }));

    // 注册命令：一键安装 Copilot MCP 工具
    subs.push(vscode.commands.registerCommand('innovus-tcl.installMcp', async () => {
        const isZh = db.getLanguage() === 'zh';
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage(
                isZh ? '请先打开一个工作区文件夹。' : 'Please open a workspace folder first.'
            );
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // ---- 步骤 1: 探测 MCP Server 脚本路径 ----
        const extPath = context.extensionPath;
        let mcpScript = path.join(extPath, 'scripts', 'mcp-server.mjs');

        // 检查文件是否存在
        if (!fs.existsSync(mcpScript)) {
            // 可能在开发模式下，脚本在项目目录中
            const devPath = path.join(extPath, 'scripts', 'mcp-server.mjs');
            if (fs.existsSync(devPath)) {
                mcpScript = devPath;
            } else {
                vscode.window.showErrorMessage(
                    isZh
                        ? `找不到 MCP Server 脚本。\n预期位置: ${mcpScript}\n\n请确认扩展安装完整。`
                        : `MCP Server script not found.\nExpected: ${mcpScript}\n\nPlease verify the extension installation.`
                );
                return;
            }
        }

        // ---- 步骤 2: 探测数据目录 ----
        let dataRoot = '';
        const cfg = vscode.workspace.getConfiguration('innovus-tcl');
        const configuredRoot = cfg.get<string>('dataRoot', '');
        if (configuredRoot && fs.existsSync(configuredRoot)) {
            dataRoot = configuredRoot;
        } else {
            // 自动探测
            const candidates = [
                path.join(extPath, 'data'),
                path.join(workspaceRoot, '..', 'data_base'),
                path.join(workspaceRoot, 'data_base'),
                path.join(extPath, '..', 'data_base'),
            ];
            for (const c of candidates) {
                const helpDir = path.join(c, 'cn', 'help');
                if (fs.existsSync(c) && fs.existsSync(helpDir)) {
                    dataRoot = c;
                    break;
                }
            }
        }

        if (!dataRoot) {
            vscode.window.showErrorMessage(
                isZh
                    ? '找不到 Innovus 命令数据目录。请先在设置中配置 innovus-tcl.dataRoot。'
                    : 'Cannot find Innovus command data directory. Please configure innovus-tcl.dataRoot in settings first.'
            );
            return;
        }

        // ---- 步骤 3: 探测 Node.js ----
        const nodeCommand = process.execPath.includes('node') ? process.execPath : 'node';

        // ---- 步骤 4: 选择语言 ----
        const lang = db.getLanguage();

        // ---- 步骤 5: 写入 .vscode/mcp.json ----
        const vscodeDir = path.join(workspaceRoot, '.vscode');
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        const mcpConfigPath = path.join(vscodeDir, 'mcp.json');

        // 检查是否已存在配置
        let existingConfig: { servers: Record<string, unknown> } = { servers: {} };
        if (fs.existsSync(mcpConfigPath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
                if (existing.servers) {
                    existingConfig = existing;
                }
            } catch { /* 忽略解析错误，覆盖写入 */ }
        }

        // 添加 innovus-tcl 配置
        existingConfig.servers['innovus-tcl'] = {
            type: 'stdio',
            command: nodeCommand,
            args: [
                mcpScript,
                '--data-root', dataRoot,
                '--lang', lang
            ]
        };

        fs.writeFileSync(mcpConfigPath, JSON.stringify(existingConfig, null, 2), 'utf-8');

        // ---- 步骤 6: 确认 ----
        const msg = isZh
            ? [
                `✅ MCP 工具安装成功！`,
                ``,
                `📁 配置文件: .vscode/mcp.json`,
                `📜 MCP 脚本: ${mcpScript}`,
                `📦 数据目录: ${dataRoot}`,
                `🌐 语言: ${lang === 'zh' ? '中文' : 'English'}`,
                ``,
                `🔧 已注册工具:`,
                `   • innovus_parse_tcl_script — 解析 TCL 脚本 + 命令文档查询`,
                `   • innovus_lint_tcl_script — TCL 脚本静态检查`,
                ``,
                `⚠️ 请重新加载窗口以使 MCP 工具生效:`,
                `   Ctrl+Shift+P → "Developer: Reload Window"`,
                ``,
                `💡 之后在 Copilot Chat 中直接说:`,
                `   "分析我当前打开的 TCL 脚本"`,
            ].join('\n')
            : [
                `✅ MCP Tools Installed Successfully!`,
                ``,
                `📁 Config: .vscode/mcp.json`,
                `📜 Script: ${mcpScript}`,
                `📦 Data: ${dataRoot}`,
                `🌐 Language: ${lang}`,
                ``,
                `🔧 Registered Tools:`,
                `   • innovus_parse_tcl_script — Parse TCL + command docs`,
                `   • innovus_lint_tcl_script — TCL static lint`,
                ``,
                `⚠️ Reload window for MCP tools to take effect:`,
                `   Ctrl+Shift+P → "Developer: Reload Window"`,
                ``,
                `💡 Then in Copilot Chat, just say:`,
                `   "Analyze my current TCL script"`,
            ].join('\n');

        const reloadAction = isZh ? '🔄 重新加载窗口' : '🔄 Reload Window';
        const result = await vscode.window.showInformationMessage(msg, { modal: true }, reloadAction);

        if (result === reloadAction) {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }));

    // 清理
    subs.push({ dispose: () => diagnosticsProvider?.dispose() });

    context.subscriptions.push(...subs);
}

export function deactivate() {
    if (diagnosticsProvider) {
        diagnosticsProvider.dispose();
    }
}

/**
 * 生成 MCP 工具配置指南
 */
function generateMcpGuide(isZh: boolean): string {
    const extPath = '[扩展安装路径]/fd-echoro.innovus-tcl-enhance-[版本号]';
    return isZh ? `# 🔧 Innovus TCL MCP 工具配置指南

## 什么是 MCP 工具？

MCP (Model Context Protocol) 允许 Copilot 直接调用扩展提供的工具。配置后，在 Copilot Chat 中：
- Copilot 可以**自动**调用 \`innovus_parse_tcl_script\` 解析 TCL 脚本并获取命令文档
- Copilot 可以**自动**调用 \`innovus_lint_tcl_script\` 检查 TCL 脚本错误

这样 Copilot 就能基于**真实命令文档**写出低幻觉的 TCL 代码。

## 配置步骤

### 1. 找到 MCP Server 脚本路径

MCP Server 脚本位于扩展目录中：
\`\`\`
${extPath}/scripts/mcp-server.mjs
\`\`\`

### 2. 找到数据目录路径

数据目录包含 Innovus 命令的 JSON 文档，通常位于：
\`\`\`
/path/to/data_base
\`\`\`

### 3. 配置 VS Code

在项目根目录创建 \`.vscode/mcp.json\`：

\`\`\`json
{
    "servers": {
        "innovus-tcl": {
            "type": "stdio",
            "command": "node",
            "args": [
                "${extPath}/scripts/mcp-server.mjs",
                "--data-root",
                "/path/to/data_base",
                "--lang",
                "zh"
            ]
        }
    }
}
\`\`\`

### 4. 重新加载 VS Code 窗口

\`Ctrl+Shift+P\` → \`Developer: Reload Window\`

### 5. 在 Copilot Chat 中测试

打开 Copilot Chat，输入：
> 分析我当前打开的 TCL 脚本

Copilot 会自动调用 MCP 工具获取命令文档并进行 AI 分析。

## MCP 工具列表

| 工具名 | 功能 |
|--------|------|
| \`innovus_parse_tcl_script\` | 解析 TCL 脚本，返回所有命令的完整文档 + 参数对照表 |
| \`innovus_lint_tcl_script\` | 静态检查 TCL 脚本（括号/引号/命令参数） |
` : `# 🔧 Innovus TCL MCP Tool Configuration Guide

## What are MCP Tools?

MCP (Model Context Protocol) allows Copilot to directly call tools provided by extensions. Once configured, in Copilot Chat:
- Copilot can **automatically** call \`innovus_parse_tcl_script\` to parse TCL scripts and get command docs
- Copilot can **automatically** call \`innovus_lint_tcl_script\` to check TCL scripts for errors

This enables Copilot to write low-hallucination TCL code based on **real command documentation**.

## Setup Steps

### 1. Find the MCP Server Script

The MCP server script is located in the extension directory:
\`\`\`
${extPath}/scripts/mcp-server.mjs
\`\`\`

### 2. Find the Data Directory

The data directory contains Innovus command JSON docs, typically at:
\`\`\`
/path/to/data_base
\`\`\`

### 3. Configure VS Code

Create \`.vscode/mcp.json\` in your project root:

\`\`\`json
{
    "servers": {
        "innovus-tcl": {
            "type": "stdio",
            "command": "node",
            "args": [
                "${extPath}/scripts/mcp-server.mjs",
                "--data-root",
                "/path/to/data_base",
                "--lang",
                "zh"
            ]
        }
    }
}
\`\`\`

### 4. Reload VS Code Window

\`Ctrl+Shift+P\` → \`Developer: Reload Window\`

### 5. Test in Copilot Chat

Open Copilot Chat and type:
> Analyze my current TCL script

Copilot will automatically call the MCP tools to get command documentation and perform AI analysis.

## MCP Tools

| Tool Name | Function |
|-----------|----------|
| \`innovus_parse_tcl_script\` | Parse TCL script, return full docs + parameter comparison for all commands |
| \`innovus_lint_tcl_script\` | Static lint check (brackets/quotes/command parameters) |
`;
}
