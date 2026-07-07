/**
 * Innovus TCL Helper - VS Code 插件入口
 *
 * 功能:
 * 1. Hover 悬停显示 Innovus 命令文档（中/英文可切换）
 * 2. 命令名和参数自动补全
 * 3. TCL 基础语法静态检查 + Innovus 命令参数校验
 * 4. 支持 Innovus 版本选择与中英文切换
 */

import * as vscode from 'vscode';
import { getDB, Language } from './commands';
import { InnovusHoverProvider } from './hover';
import { InnovusCompletionProvider } from './completion';
import { TclDiagnosticsProvider } from './diagnostics';

let diagnosticsProvider: TclDiagnosticsProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('[Innovus TCL] 插件已激活');

    const config = vscode.workspace.getConfiguration('innovus-tcl');

    // 初始化命令数据库
    const db = getDB(context.extensionPath);

    // 读取语言设置
    const lang = config.get<string>('language', 'zh') as Language;
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

    // 监听配置变更，切换语言时自动重载
    subs.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('innovus-tcl.language')) {
            const newLang = vscode.workspace.getConfiguration('innovus-tcl').get<string>('language', 'zh') as Language;
            db.setLanguage(newLang);
            vscode.window.showInformationMessage(
                `Innovus TCL: 已切换为${newLang === 'zh' ? '中文' : 'English'} (${db.getCommandNames().length} 命令)`
            );
        }
        if (e.affectsConfiguration('innovus-tcl.dataRoot') || e.affectsConfiguration('innovus-tcl.version')) {
            const newRoot = vscode.workspace.getConfiguration('innovus-tcl').get<string>('dataRoot', '');
            if (newRoot) { db.setDataRoot(newRoot); }
            const newVer = vscode.workspace.getConfiguration('innovus-tcl').get<string>('version', '');
            if (newVer) { db.setVersion(newVer); }
            db.reload();
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
        const count = db.getCommandNames().length;
        const langLabel = db.getLanguage() === 'zh' ? '中文' : 'English';
        const msg = [
            `🚀 Innovus TCL Helper v0.1.0`,
            ``,
            `📦 已加载命令: ${count} 个`,
            `🌐 当前语言: ${langLabel}`,
            `🔍 悬停提示: ${config.get('enableHover') ? '✅' : '❌'}`,
            `✏️  自动补全: ${config.get('enableCompletion') ? '✅' : '❌'}`,
            `⚠️  静态检查: ${config.get('enableDiagnostics') ? '✅' : '❌'}`,
        ].join('\n');
        vscode.window.showInformationMessage(msg, { modal: true });
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
