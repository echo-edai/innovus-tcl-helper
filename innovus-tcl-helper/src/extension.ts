/**
 * Innovus TCL Helper - VS Code 插件入口
 *
 * 功能:
 * 1. Hover 悬停显示 Innovus 命令文档（中/英文可切换）
 * 2. 命令名和参数自动补全
 * 3. TCL 基础语法静态检查 + Innovus 命令参数校验（3 级别）
 * 4. 跨文件 TCL 脚本编译分析 + 变量追踪（.f 文件驱动）
 * 5. 多版本 Innovus 数据支持
 * 6. Copilot AI 工具集成（LM Tools）
 * 7. F12/Ctrl+Click 帮助文档跳转
 * 8. Semantic Tokens 语法高亮
 * 9. MCP Lint 接口暴露
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getDB, Language } from './commands';
import { InnovusHoverProvider, setBuiltinsDataRoot } from './hover';
import { InnovusCompletionProvider } from './completion';
import { TclDiagnosticsProvider } from './diagnostics';
import { TclLintProvider } from './lint';
import { InnovusDefinitionProvider, InnovusPlainHelpProvider, InnovusDocumentLinkProvider, TclVariableDefinitionProvider, showHelp } from './definition';
import { InnovusSemanticTokensProvider } from './semantic';
import { registerAllTools, buildScriptContextForCommand } from './tools';

let diagnosticsProvider: TclDiagnosticsProvider | undefined;
let lintProvider: TclLintProvider | undefined;
let variableDefProvider: TclVariableDefinitionProvider | undefined;

/**
 * 自动安装 Agent Skills 到工作区 .agents/skills/&lt;name&gt;/SKILL.md。
 * VS Code Copilot 自动发现 .agents/skills 下的 SKILL.md 文件。
 * 扩展激活时调用，每个 skill 独立子目录，名称为小写连字符格式。
 */
function installAgentSkills(extensionPath: string): void {
    const skillName = 'innovus-tcl-helper';
    const srcDir = path.join(extensionPath, '.agents', 'skills', skillName);
    if (!fs.existsSync(srcDir)) { return; }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) { return; }

    for (const ws of workspaceFolders) {
        try {
            const targetDir = path.join(ws.uri.fsPath, '.agents', 'skills', skillName);
            if (!fs.existsSync(targetDir)) { fs.mkdirSync(targetDir, { recursive: true }); }

            // 递归复制源目录下所有文件
            const copyDir = (src: string, dest: string) => {
                for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
                    const s = path.join(src, entry.name);
                    const d = path.join(dest, entry.name);
                    if (entry.isDirectory()) {
                        if (!fs.existsSync(d)) { fs.mkdirSync(d, { recursive: true }); }
                        copyDir(s, d);
                    } else {
                        let shouldCopy = !fs.existsSync(d);
                        if (!shouldCopy) {
                            shouldCopy = fs.statSync(s).mtimeMs > fs.statSync(d).mtimeMs;
                        }
                        if (shouldCopy) {
                            fs.copyFileSync(s, d);
                            console.log(`[Innovus TCL] Skill installed: ${d}`);
                        }
                    }
                }
            };
            copyDir(srcDir, targetDir);
        } catch (e: any) {
            console.log(`[Innovus TCL] Skill install skipped: ${e.message}`);
        }
    }
}

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

    // ── 自动安装 Agent Skills 到工作区 .vscode/skills/ ──
    installAgentSkills(context.extensionPath);

    // 初始化 TCL 内建关键字文档路径
    setBuiltinsDataRoot(context.extensionPath);

    const config = vscode.workspace.getConfiguration('innovus-tcl');

    // 初始化命令数据库 — 始终使用扩展内置 data/innovus/ 目录
    const db = getDB(context.extensionPath);

    // 读取语言设置
    const rawLang = config.get<string>('language', 'auto');
    const lang = resolveLanguage(rawLang);
    db.setLanguage(lang);

    // 读取版本设置（默认 25.1）
    const version = config.get<string>('version', '25.1');
    db.setVersion(version);

    db.load();

    const subs: vscode.Disposable[] = [];

    // 1. Hover Provider - 命令悬停提示 + 跨文件变量值显示
    const hoverProvider = new InnovusHoverProvider();
    if (config.get<boolean>('enableHover', true)) {
        subs.push(vscode.languages.registerHoverProvider(
            { language: 'tcl' },
            hoverProvider
        ));
    }

    // 提前创建 Variable Definition Provider（后续 setLintProvider 需要引用）
    variableDefProvider = new TclVariableDefinitionProvider();

    // 2. Completion Provider - 命令/参数自动补全
    if (config.get<boolean>('enableCompletion', true)) {
        subs.push(vscode.languages.registerCompletionItemProvider(
            { language: 'tcl' },
            new InnovusCompletionProvider(),
            ' ', '-', '_'
        ));
    }

    // 3a. Diagnostics - 单文件语法与命令检查
    if (config.get<boolean>('enableDiagnostics', true)) {
        diagnosticsProvider = new TclDiagnosticsProvider();

        if (vscode.window.activeTextEditor) {
            diagnosticsProvider.updateDiagnostics(vscode.window.activeTextEditor.document);
        }

        subs.push(vscode.workspace.onDidSaveTextDocument((doc) => {
            diagnosticsProvider?.updateDiagnostics(doc);
            // 同时触发增量跨文件 lint
            if (doc.languageId === 'tcl' && lintProvider) {
                lintProvider.runIncrementalLint(doc);
            }
        }));

        subs.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                diagnosticsProvider?.updateDiagnostics(editor.document);
            }
        }));
    }

    // 3b. Cross-file Lint - 跨文件编译分析与变量追踪
    if (config.get<boolean>('enableCompilation', true)) {
        lintProvider = new TclLintProvider();
        hoverProvider.setLintProvider(lintProvider);
        variableDefProvider!.setLintProvider(lintProvider);

        // 初始运行 lint
        if (vscode.window.activeTextEditor?.document.languageId === 'tcl') {
            lintProvider.runLint(vscode.window.activeTextEditor.document);
        }

        // 文件保存时增量更新
        subs.push(vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.languageId === 'tcl' && lintProvider) {
                lintProvider.runIncrementalLint(doc);
            }
        }));

        // .f 文件变化时重新编译
        subs.push(vscode.workspace.onDidSaveTextDocument((doc) => {
            const fFile = vscode.workspace.getConfiguration('innovus-tcl')
                .get<string>('fFile', 'tcl.f');
            if (doc.fileName.endsWith('.f') || doc.fileName.endsWith(fFile)) {
                if (lintProvider) {
                    lintProvider.runLint();
                    vscode.window.setStatusBarMessage(
                        `$(sync) Innovus TCL: 已重新编译 (${lintProvider.getLastResult()?.units.length || 0} 文件)`,
                        3000
                    );
                }
            }
        }));

        // 编辑器切换时刷新
        subs.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && editor.document.languageId === 'tcl' && lintProvider) {
                // 不重编译，但确保诊断显示
                lintProvider.runLint();
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

    // 4b. Variable Definition Provider — F12/Ctrl+Click 跳转到 $varName 定义位置
    subs.push(vscode.languages.registerDefinitionProvider(
        { language: 'tcl' },
        variableDefProvider
    ));

    // 4c. Document Link Provider — Ctrl+Click 入口（始终生效，模式在回调中判断）
    subs.push(vscode.languages.registerDocumentLinkProvider(
        { language: 'tcl' },
        new InnovusDocumentLinkProvider()
    ));

    // 4d. Ctrl+Click 回调命令 — 根据当前模式打开 Webview 或虚拟文档
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

    // 监听配置变更，切换语言/版本/AI工具/编译时自动重载
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
        if (e.affectsConfiguration('innovus-tcl.version')) {
            const newVer = cfg.get<string>('version', '25.1');
            db.setVersion(newVer);
            db.reload();
            vscode.window.showInformationMessage(
                `Innovus TCL: 已切换至版本 ${db.getVersion() || '(默认)'}，${db.getCommandNames().length} 个命令`
            );
        }
        if (e.affectsConfiguration('innovus-tcl.enableAITools')) {
            const aiEnabled = cfg.get<boolean>('enableAITools', true);
            if (aiEnabled) {
                vscode.window.showInformationMessage(
                    'Innovus TCL: Copilot AI 工具已启用。\n\n在 Copilot Chat 中，你可以:\n• 查询所有 Innovus 命令\n• 获取命令的详细语法和参数\n• 解析 TCL 脚本生成描述\n• 获取跨文件编译分析和 Lint 报告\n\n💡 请重新加载窗口以使 AI 工具生效。',
                    { modal: true }
                );
            }
        }
        if (e.affectsConfiguration('innovus-tcl.fFile') ||
            e.affectsConfiguration('innovus-tcl.enableCompilation')) {
            if (lintProvider && cfg.get<boolean>('enableCompilation', true)) {
                lintProvider.runLint();
                vscode.window.showInformationMessage(
                    `Innovus TCL: 已重新编译 (${lintProvider.getLastResult()?.units.length || 0} 文件)`
                );
            } else if (!cfg.get<boolean>('enableCompilation', true)) {
                lintProvider?.clear();
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
            `🚀 Innovus TCL Helper v0.4.0`,
            ``,
            `📦 已加载条目: ${stats.totalEntries} 个`,
            `   ├─ 命令: ${stats.commands} 个`,
            `   └─ 变量/模式: ${stats.variables} 个`,
            `🔢 Innovus 版本: ${versionLabel}`,
            `🌐 当前语言: ${langLabel}`,
            `🔍 悬停提示: ${config.get('enableHover') ? '✅' : '❌'}`,
            `✏️  自动补全: ${config.get('enableCompletion') ? '✅' : '❌'}`,
            `⚠️  静态检查: ${config.get('enableDiagnostics') ? '✅' : '❌'} (${levelLabels[level] || level})`,
            `🔗 跨文件编译: ${config.get('enableCompilation') ? '✅' : '❌'}`,
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
            detail: v.label === currentVer || (!currentVer && v.label === '25.1')
                ? (isZh ? '● 当前使用' : '● Current')
                : ''
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: isZh ? '选择版本 (test=关闭高亮, 25.1=完整数据)' : 'Select version (test=no highlight, 25.1=full data)'
        });

        if (picked) {
            const cfg = vscode.workspace.getConfiguration('innovus-tcl');
            await cfg.update('version', picked.label, vscode.ConfigurationTarget.Global);
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
                    ? '将所有命令的完整文档 + 参数对照表拼接为 Markdown'
                    : 'Concatenate all command docs + parameter comparison as Markdown'
            }
        ];

        if (mcpAvailable) {
            options.push({
                label: '🤖 ' + (isZh ? 'Copilot AI 分析 (MCP)' : 'Copilot AI Analysis (MCP)'),
                description: isZh
                    ? '复制分析提示词到剪贴板，粘贴到 Copilot Chat 即可'
                    : 'Copy analysis prompt to clipboard, paste in Copilot Chat'
            });
        } else {
            options.push({
                label: '🔧 ' + (isZh ? '一键安装 MCP 工具' : 'Install MCP Tools'),
                description: isZh
                    ? '自动配置 MCP 工具，之后可用 AI 分析脚本'
                    : 'Auto-configure MCP tools for AI analysis'
            });
        }

        const choice = await vscode.window.showQuickPick(options, {
            placeHolder: isZh ? '选择分析方式' : 'Select analysis mode'
        });

        if (!choice) { return; }

        const content = editor.document.getText();
        const sourceLabel = editor.document.uri.fsPath || (isZh ? '当前脚本' : 'current script');

        if (choice.label.startsWith('📋')) {
            // 拼接文档模式 — 纯文档，不含 AI 分析任务
            const report = buildScriptContextForCommand(content, sourceLabel, false);
            const doc = await vscode.workspace.openTextDocument({
                content: report,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: true
            });
        } else if (choice.label.startsWith('🤖')) {
            // AI 分析模式 — 复制提示词到剪贴板，不发文件
            const prompt = buildAiAnalysisPrompt(context.extensionPath, sourceLabel, isZh);
            await vscode.env.clipboard.writeText(prompt);
            vscode.window.showInformationMessage(
                isZh
                    ? '✅ 分析提示词已复制到剪贴板！请粘贴到 Copilot Chat 中。'
                    : '✅ Analysis prompt copied to clipboard! Paste it in Copilot Chat.',
                { modal: true }
            );
        } else {
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
            // 自动探测: 查找 data/cmds/innovus/ 目录
            const candidates = [
                path.join(extPath, 'data'),
                path.join(workspaceRoot, 'data'),
            ];
            for (const c of candidates) {
                const testHelpDir = path.join(c, 'cmds', 'innovus', '25.1', 'cn', 'help');
                if (fs.existsSync(c) && fs.existsSync(testHelpDir)) {
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

    // 注册命令：安装 Agent Skills
    subs.push(vscode.commands.registerCommand('innovus-tcl.installSkills', async () => {
        const isZh = db.getLanguage() === 'zh';
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage(
                isZh ? '请先打开一个工作区文件夹。' : 'Please open a workspace folder first.'
            );
            return;
        }

        installAgentSkills(context.extensionPath);

        const msg = [
            isZh ? '✅ Agent Skill 已安装' : '✅ Agent Skill Installed',
            '',
            '`.agents/skills/innovus-tcl-helper/SKILL.md`',
            '',
            isZh
                ? '💡 使用 `/skills` 查看已安装的 skill。在 Copilot Chat 中输入 Innovus TCL 问题自动激活。'
                : '💡 Use `/skills` to verify. Ask Innovus TCL questions in Copilot Chat.',
        ].join('\n');

        vscode.window.showInformationMessage(msg, { modal: true });
    }));

    // 注册命令：运行跨文件编译 Lint
    subs.push(vscode.commands.registerCommand('innovus-tcl.runLint', () => {
        if (!lintProvider) {
            vscode.window.showWarningMessage(
                db.getLanguage() === 'zh'
                    ? '跨文件编译分析未启用。请在设置中启用 innovus-tcl.enableCompilation。'
                    : 'Cross-file compilation is disabled. Enable innovus-tcl.enableCompilation in settings.'
            );
            return;
        }
        lintProvider.runLint();
        const result = lintProvider.getLastResult();
        const isZh = db.getLanguage() === 'zh';
        if (result) {
            const msg = isZh
                ? `✅ 编译完成: ${result.units.length} 文件, ${Array.from(result.variables.values()).reduce((s, v) => s + v.length, 0)} 变量, ${result.errors.length} 错误, ${result.warnings.length} 警告`
                : `✅ Compilation done: ${result.units.length} files, ${Array.from(result.variables.values()).reduce((s, v) => s + v.length, 0)} variables, ${result.errors.length} errors, ${result.warnings.length} warnings`;
            vscode.window.showInformationMessage(msg);
        }
    }));

    // 注册命令：显示 Lint 报告
    subs.push(vscode.commands.registerCommand('innovus-tcl.showLintReport', async () => {
        if (!lintProvider || !lintProvider.getLastResult()) {
            vscode.window.showWarningMessage(
                db.getLanguage() === 'zh'
                    ? '请先运行编译分析 (Cmd+Shift+P → Innovus TCL: 运行跨文件 Lint)。'
                    : 'Run compilation first (Cmd+Shift+P → Innovus TCL: Run Cross-file Lint).'
            );
            return;
        }
        const isZh = db.getLanguage() === 'zh';
        const format = await vscode.window.showQuickPick(
            [
                { label: '📝 Markdown', description: isZh ? '格式化的 Lint 报告' : 'Formatted lint report' },
                { label: '📊 JSON', description: isZh ? '结构化 JSON 报告' : 'Structured JSON report' }
            ],
            { placeHolder: isZh ? '选择报告格式' : 'Select report format' }
        );

        if (!format) { return; }

        const report = lintProvider.generateLintReport(
            format.label.includes('JSON') ? 'json' : 'text'
        );

        if (format.label.includes('JSON')) {
            // JSON 格式化显示
            const formatted = JSON.stringify(JSON.parse(report), null, 2);
            const doc = await vscode.workspace.openTextDocument({
                content: formatted,
                language: 'json'
            });
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: true
            });
        } else {
            const doc = await vscode.workspace.openTextDocument({
                content: report,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: true
            });
        }
    }));

    // 注册命令：打开 .f 文件
    subs.push(vscode.commands.registerCommand('innovus-tcl.openFFile', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage(
                db.getLanguage() === 'zh' ? '请先打开一个工作区。' : 'Please open a workspace first.'
            );
            return;
        }
        const fFile = vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('fFile', 'tcl.f');
        const fFilePath = path.join(workspaceFolders[0].uri.fsPath, fFile);

        // 如果 .f 文件不存在，创建一个空的
        if (!fs.existsSync(fFilePath)) {
            const defaultContent = db.getLanguage() === 'zh'
                ? '# Innovus TCL 编译文件列表\n# 每行一个 .tcl 文件路径（相对路径）\n# 按顺序从上到下编译\n'
                : '# Innovus TCL compilation file list\n# One .tcl file per line (relative path)\n# Compiled in order from top to bottom\n';
            fs.writeFileSync(fFilePath, defaultContent, 'utf-8');
        }

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fFilePath));
        await vscode.window.showTextDocument(doc);
    }));

    // 注册命令：编辑 AI 提示词
    subs.push(vscode.commands.registerCommand('innovus-tcl.editPrompt', async () => {
        const isZh = db.getLanguage() === 'zh';
        const langDir = isZh ? 'cn' : 'en';
        const cachePath = path.join(context.extensionPath, 'data', 'cache', langDir, 'ai-prompt.md');
        const systemPath = path.join(context.extensionPath, 'prompts', langDir, 'ai-analysis.md');

        // 读取系统默认 + 用户默认
        let systemPrompt = '';
        try { systemPrompt = fs.readFileSync(systemPath, 'utf-8').trim(); } catch { /* ignore */ }
        let userPrompt = '';
        const hasUserPrompt = fs.existsSync(cachePath);
        if (hasUserPrompt) {
            try { userPrompt = fs.readFileSync(cachePath, 'utf-8').trim(); } catch { /* ignore */ }
        }

        const activeSource = userPrompt
            ? (isZh ? `（当前：用户默认 data/cache/${langDir}/ai-prompt.md）` : `(Active: user default data/cache/${langDir}/ai-prompt.md)`)
            : (isZh ? `（当前：系统默认 prompts/${langDir}/ai-analysis.md）` : `(Active: system default prompts/${langDir}/ai-analysis.md)`);

        const actionEdit = isZh ? '✏️ 编辑用户默认提示词' : '✏️ Edit User Default';
        const actionReset = isZh ? '🔄 恢复系统默认' : '🔄 Reset to System Default';
        const actionView = isZh ? '👁️ 查看当前生效提示词' : '👁️ View Active Prompt';

        const choice = await vscode.window.showQuickPick(
            [
                { label: actionEdit, description: isZh ? `编辑 data/cache/${langDir}/ai-prompt.md` : `Edit data/cache/${langDir}/ai-prompt.md` },
                { label: actionReset, description: isZh ? `删除用户提示词，回退到 prompts/${langDir}/ai-analysis.md` : `Delete user prompt, fall back to prompts/${langDir}/ai-analysis.md` },
                { label: actionView, description: activeSource }
            ],
            { placeHolder: isZh ? '选择操作' : 'Select action' }
        );

        if (!choice) { return; }

        if (choice.label === actionEdit) {
            // 确保 cache 目录存在
            const cacheDir = path.dirname(cachePath);
            if (!fs.existsSync(cacheDir)) { fs.mkdirSync(cacheDir, { recursive: true }); }

            // 如果用户还没创建过，从系统默认复制一份
            if (!hasUserPrompt) {
                fs.writeFileSync(cachePath, systemPrompt || (isZh ? '# 在此处编写你的自定义 AI 分析提示词\n' : '# Write your custom AI analysis prompt here\n'), 'utf-8');
            }

            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(cachePath));
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(
                isZh
                    ? '💡 编辑后 Ctrl+S 保存即可。此文件会覆盖系统默认提示词。'
                    : '💡 Edit and Ctrl+S to save. This file overrides the system default prompt.'
            );
        } else if (choice.label === actionReset) {
            if (hasUserPrompt) {
                fs.unlinkSync(cachePath);
                vscode.window.showInformationMessage(
                    isZh
                        ? `✅ 已删除用户提示词，恢复为系统默认 prompts/${langDir}/ai-analysis.md。`
                        : `✅ User prompt deleted. Restored to system default prompts/${langDir}/ai-analysis.md.`
                );
            } else {
                vscode.window.showInformationMessage(
                    isZh
                        ? '当前已是系统默认提示词，无需恢复。'
                        : 'Already using system default prompt.'
                );
            }
        } else {
            // View current
            const active = userPrompt || systemPrompt || (isZh ? '(无提示词)' : '(no prompt)');
            const source = userPrompt
                ? (isZh ? `来源：data/cache/${langDir}/ai-prompt.md` : `Source: data/cache/${langDir}/ai-prompt.md`)
                : (isZh ? `来源：prompts/${langDir}/ai-analysis.md（系统默认）` : `Source: prompts/${langDir}/ai-analysis.md (system default)`);
            const viewDoc = await vscode.workspace.openTextDocument({
                content: `# ${isZh ? '当前生效 AI 分析提示词' : 'Active AI Analysis Prompt'}\n\n> ${source}\n\n${active}`,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(viewDoc, { preview: true });
        }
    }));

    // 注册命令：打开示例 TCL 脚本
    subs.push(vscode.commands.registerCommand('innovus-tcl.openExample', async () => {
        const isZh = db.getLanguage() === 'zh';
        const exampleDir = path.join(context.extensionPath, 'data', 'example', 'innovus');

        if (!fs.existsSync(exampleDir)) {
            vscode.window.showErrorMessage(
                isZh
                    ? `示例目录不存在: ${exampleDir}`
                    : `Example directory not found: ${exampleDir}`
            );
            return;
        }

        // 读取所有 .tcl 文件
        const tclFiles = fs.readdirSync(exampleDir)
            .filter(f => f.endsWith('.tcl'))
            .sort();

        if (tclFiles.length === 0) {
            vscode.window.showInformationMessage(
                isZh ? '示例目录中没有 .tcl 文件。' : 'No .tcl files in example directory.'
            );
            return;
        }

        // 预览每份文件的前几行作为描述
        const items = tclFiles.map(f => {
            const filePath = path.join(exampleDir, f);
            let preview = '';
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const firstLine = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))[0] || '';
                preview = firstLine.substring(0, 60) + (firstLine.length > 60 ? '...' : '');
            } catch { /* ignore */ }
            return {
                label: f,
                description: preview,
                detail: filePath
            };
        });

        const picked = await vscode.window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: isZh
                ? `选择示例脚本 (${tclFiles.length} 个文件)`
                : `Select example script (${tclFiles.length} files)`
        });

        if (picked) {
            const doc = await vscode.workspace.openTextDocument(picked.detail);
            await vscode.window.showTextDocument(doc, { preview: false });
        }
    }));

    // 清理
    subs.push({ dispose: () => diagnosticsProvider?.dispose() });
    subs.push({ dispose: () => lintProvider?.dispose() });

    context.subscriptions.push(...subs);
}

/**
 * 构建 AI 分析提示词（复制到剪贴板，用户粘贴到 Copilot Chat）
 *
 * 优先级:
 *   1. VS Code 设置 innovus-tcl.aiPrompt（最高）
 *   2. data/cache/{cn|en}/ai-prompt.md（用户默认）
 *   3. prompts/{cn|en}/ai-analysis.md（系统默认，随扩展发布）
 */
function buildAiAnalysisPrompt(extensionPath: string, sourceLabel: string, isZh: boolean): string {
    const langDir = isZh ? 'cn' : 'en';
    const cachePath = path.join(extensionPath, 'data', 'cache', langDir, 'ai-prompt.md');
    const systemPath = path.join(extensionPath, 'prompts', langDir, 'ai-analysis.md');

    // 1. VS Code 设置
    const cfg = vscode.workspace.getConfiguration('innovus-tcl');
    const customPrompt = cfg.get<string>('aiPrompt', '');
    if (customPrompt) {
        return customPrompt.replace(/\{script_name\}/g, sourceLabel);
    }

    // 2. 用户默认 (data/cache/ai-prompt.md)
    if (cachePath && fs.existsSync(cachePath)) {
        try {
            const userPrompt = fs.readFileSync(cachePath, 'utf-8').trim();
            if (userPrompt) {
                return userPrompt.replace(/\{script_name\}/g, sourceLabel);
            }
        } catch { /* fall through */ }
    }

    // 3. 系统默认 (prompts/ai-analysis.md)
    if (systemPath && fs.existsSync(systemPath)) {
        try {
            const sysPrompt = fs.readFileSync(systemPath, 'utf-8').trim();
            return sysPrompt.replace(/\{script_name\}/g, sourceLabel);
        } catch { /* fall through */ }
    }

    // 硬兜底
    return isZh
        ? `请分析 Innovus TCL 脚本 \`${sourceLabel}\`。调用 innovus_lint_tcl_script 和 innovus_parse_tcl_script MCP 工具，基于返回的文档进行分析，输出 Markdown 代码块。`
        : `Analyze the Innovus TCL script \`${sourceLabel}\`. Call innovus_lint_tcl_script and innovus_parse_tcl_script MCP tools, analyze based on returned docs, output in Markdown code block.`;
}

export function deactivate() {
    if (diagnosticsProvider) {
        diagnosticsProvider.dispose();
    }
    if (lintProvider) {
        lintProvider.dispose();
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
