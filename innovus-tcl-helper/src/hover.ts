/**
 * Hover Provider - 鼠标悬浮时显示 Innovus 命令/变量/TCL 关键字的帮助
 *
 * 支持:
 *   1. Innovus 命令文档（来自命令数据库）
 *   2. TCL 变量值（来自跨文件编译分析）
 *   3. $varName 变量引用值
 *   4. TCL 内建关键字文档（来自 data/tcl-builtins/）
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getDB, CmdInfo, CmdOption } from './commands';
import { TclLintProvider } from './lint';

// ════════════════════════════════════════════════════════════
//  TCL 内建关键字文件加载
// ════════════════════════════════════════════════════════════

interface TclBuiltinDoc {
    command: string;
    category: string;
    summary: string;
    usage: string;
    description: string;
    note?: string;
}

/** 缓存已加载的文档 */
const builtinCache: Map<string, TclBuiltinDoc> = new Map();
let builtinsDataRoot: string = '';

/** 设置 TCL 内建文档数据根目录 */
export function setBuiltinsDataRoot(extensionPath: string): void {
    builtinsDataRoot = path.join(extensionPath, 'data', 'tcl-builtins');
}

/** 加载 TCL 内建关键字文档 */
function loadBuiltinDoc(cmdName: string, lang: string): TclBuiltinDoc | null {
    const cacheKey = `${lang}:${cmdName}`;
    const cached = builtinCache.get(cacheKey);
    if (cached) { return cached; }

    if (!builtinsDataRoot) { return null; }

    try {
        const filePath = path.join(builtinsDataRoot, lang, `${cmdName}.json`);
        if (!fs.existsSync(filePath)) { return null; }
        const content = fs.readFileSync(filePath, 'utf-8');
        const doc: TclBuiltinDoc = JSON.parse(content);
        builtinCache.set(cacheKey, doc);
        return doc;
    } catch {
        return null;
    }
}

export class InnovusHoverProvider implements vscode.HoverProvider {
    private lintProvider: TclLintProvider | null = null;

    /** 设置 Lint Provider 引用（用于跨文件变量查询） */
    setLintProvider(provider: TclLintProvider): void {
        this.lintProvider = provider;
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {

        const db = getDB();

        // ── 先检查是否悬浮在 $varName 上 ──
        const dollarVarHover = this.checkDollarVar(document, position);
        if (dollarVarHover) { return dollarVarHover; }

        // ── 普通词匹配 ──
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) { return null; }

        const word = document.getText(wordRange);

        // ── 检查是否为 TCL 变量（编译分析中的变量） ──
        const varHover = this.checkCompiledVariable(word, document, position, wordRange);
        if (varHover) { return varHover; }

        // ── 检查是否为 Innovus 命令 ──
        const cmdInfo = db.get(word);
        if (cmdInfo) {
            return this.buildInnovusHover(cmdInfo, wordRange);
        }

        // ── 检查是否为 TCL 内建关键字（非 Innovus 命令时） ──
        const builtinHover = this.checkTclBuiltin(word, wordRange);
        if (builtinHover) { return builtinHover; }

        return null;
    }

    /**
     * 构建 Innovus 命令的 Hover 内容。
     */
    private buildInnovusHover(cmdInfo: CmdInfo, wordRange: vscode.Range): vscode.Hover {
        const db = getDB();
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

    /**
     * 检查是否悬浮在 $varName 或 ${varName} 上。
     * 如果是，从编译分析中查找变量值并显示。
     */
    private checkDollarVar(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Hover | null {
        if (!this.lintProvider) { return null; }

        const line = document.lineAt(position.line).text;
        const col = position.character;

        // 匹配 $varName 或 ${varName}
        const dollarRegex = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z0-9_]*)*)\}?/g;
        let match: RegExpExecArray | null;

        while ((match = dollarRegex.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            if (col >= start && col <= end) {
                const varName = match[2];
                const isBraceForm = match[1] === '{';

                const result = this.lintProvider.getLastResult();
                if (!result) { return null; }

                const { definition, allDefs, refs } =
                    this.lintProvider.getCompiler().queryVariable(
                        varName, result, document.uri.fsPath, position.line + 1
                    );

                const db = getDB();
                const isZh = db.getLanguage() === 'zh';

                const markdown = new vscode.MarkdownString();
                markdown.isTrusted = true;
                markdown.supportHtml = true;

                markdown.appendMarkdown(`## \`$${isBraceForm ? '{' : ''}${varName}${isBraceForm ? '}' : ''}\` \`${isZh ? '变量引用' : 'Variable Ref'}\`\n\n`);

                if (definition) {
                    const val = definition.value || (isZh ? '(空值)' : '(empty)');
                    const displayVal = val.length > 100 ? val.substring(0, 97) + '...' : val;
                    markdown.appendMarkdown(`**${isZh ? '值' : 'Value'}:** \`${escapeCode(displayVal)}\`\n\n`);
                    markdown.appendMarkdown(`**${isZh ? '定义位置' : 'Defined at'}:** \`${definition.relativePath}:${definition.line}\`\n\n`);

                    if (!definition.isResolved) {
                        markdown.appendMarkdown(`> ⚠️ ${isZh ? '该值包含未解析的变量引用，实际值可能不同。' : 'This value contains unresolved variable references, actual value may differ.'}\n\n`);
                    }

                    // 所有定义历史
                    if (allDefs.length > 1) {
                        markdown.appendMarkdown(`---\n\n`);
                        markdown.appendMarkdown(`### ${isZh ? '历史赋值' : 'Assignment History'}\n\n`);
                        markdown.appendMarkdown(isZh
                            ? '| 值 | 文件 | 行 |\n|-----|------|----|\n'
                            : '| Value | File | Line |\n|-------|------|------|\n');
                        for (const def of allDefs) {
                            const dVal = def.value.length > 40
                                ? def.value.substring(0, 37) + '...'
                                : def.value || (isZh ? '(空)' : '(empty)');
                            markdown.appendMarkdown(`| \`${escapeCode(dVal)}\` | \`${def.relativePath}\` | ${def.line} |\n`);
                        }
                    }
                } else if (allDefs.length > 0) {
                    // 有定义但在引用之后
                    const def = allDefs[0];
                    markdown.appendMarkdown(`**${isZh ? '值' : 'Value'}:** \`${escapeCode(def.value || (isZh ? '(空)' : '(empty)'))}\`\n\n`);
                    markdown.appendMarkdown(`**${isZh ? '定义位置' : 'Defined at'}:** \`${def.relativePath}:${def.line}\`\n\n`);
                    markdown.appendMarkdown(`> ⚠️ ${isZh ? '该变量在引用之后定义。' : 'Variable defined after this reference.'}\n\n`);
                } else {
                    markdown.appendMarkdown(`> ❌ ${isZh ? '未定义的变量' : 'Undefined variable'}\n\n`);
                    markdown.appendMarkdown((isZh
                        ? '在整个编译过程中都未找到该变量的定义。'
                        : 'No definition found for this variable in the entire compilation.'));
                }

                const varRange = new vscode.Range(
                    position.line, start, position.line, end
                );
                return new vscode.Hover(markdown, varRange);
            }
        }
        return null;
    }

    /**
     * 检查普通词是否匹配编译分析中的变量名。
     * 例如在 `set my_var 1` 中的 `my_var`，悬浮时显示变量信息。
     */
    private checkCompiledVariable(
        word: string,
        document: vscode.TextDocument,
        position: vscode.Position,
        wordRange: vscode.Range
    ): vscode.Hover | null {
        if (!this.lintProvider) { return null; }

        const result = this.lintProvider.getLastResult();
        if (!result) { return null; }

        const defs = result.variables.get(word);
        if (!defs || defs.length === 0) { return null; }

        // 检查当前行是否确实在这个变量名上（不是命令名位置）
        const line = document.lineAt(position.line).text;
        const trimmed = line.trimStart();
        // 排除行首命令名匹配
        const firstWordMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (firstWordMatch && firstWordMatch[1] === word) {
            // 如果这个词是行首第一个词，并且是已知命令，不显示变量 hover
            const db = getDB();
            if (db.isCommand(word)) { return null; }
        }

        const db = getDB();
        const isZh = db.getLanguage() === 'zh';
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // 查找当前文件/行之前的最新定义
        const filePath = document.uri.fsPath;
        const refLine = position.line + 1;
        const { definition, allDefs } =
            this.lintProvider.getCompiler().queryVariable(word, result, filePath, refLine);

        markdown.appendMarkdown(`## \`${escapeCode(word)}\` \`${isZh ? 'TCL 变量' : 'TCL Variable'}\`\n\n`);

        if (definition) {
            const val = definition.value || (isZh ? '(空值)' : '(empty)');
            const displayVal = val.length > 100 ? val.substring(0, 97) + '...' : val;
            markdown.appendMarkdown(`**${isZh ? '值' : 'Value'}:** \`${escapeCode(displayVal)}\`\n\n`);
            markdown.appendMarkdown(`**${isZh ? '定义位置' : 'Defined at'}:** \`${definition.relativePath}:${definition.line}\`\n\n`);
            markdown.appendMarkdown(`**${isZh ? '原始语句' : 'Raw'}:** \`${escapeCode(definition.rawText)}\`\n\n`);

            if (!definition.isResolved) {
                markdown.appendMarkdown(`> ⚠️ ${isZh ? '该值包含未解析的变量引用。' : 'This value contains unresolved variable references.'}\n\n`);
            }
        }

        if (allDefs.length > 1) {
            markdown.appendMarkdown(`---\n\n`);
            markdown.appendMarkdown(`### ${isZh ? '赋值历史' : 'Assignment History'}\n\n`);
            markdown.appendMarkdown(isZh
                ? '| 值 | 文件 | 行 |\n|-----|------|----|\n'
                : '| Value | File | Line |\n|-------|------|------|\n');
            for (const def of allDefs) {
                const dVal = def.value.length > 40
                    ? def.value.substring(0, 37) + '...'
                    : def.value || (isZh ? '(空)' : '(empty)');
                markdown.appendMarkdown(`| \`${escapeCode(dVal)}\` | \`${def.relativePath}\` | ${def.line} |\n`);
            }
        }

        return new vscode.Hover(markdown, wordRange);
    }

    /**
     * 检查是否为 TCL 内建关键字，从 data/tcl-builtins/ 加载文档显示。
     * 只在非 Innovus 命令时触发（避免覆盖已有的详细帮助）。
     */
    private checkTclBuiltin(word: string, wordRange: vscode.Range): vscode.Hover | null {
        const db = getDB();
        const lang = db.getLanguage();
        const doc = loadBuiltinDoc(word, lang);
        if (!doc) { return null; }

        const isZh = lang === 'zh';
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // 标题 + 分类标签
        markdown.appendMarkdown(`## \`${escapeCode(doc.command)}\` \`TCL ${doc.category}\`\n\n`);

        // 语法
        if (doc.usage) {
            markdown.appendMarkdown(`### ${isZh ? '语法' : 'Syntax'}\n\n`);
            markdown.appendCodeblock(doc.usage, 'tcl');
            markdown.appendMarkdown('\n');
        }

        // 摘要 + 说明
        markdown.appendMarkdown(`**${escapeMd(doc.summary)}**\n\n`);
        markdown.appendMarkdown(escapeMd(doc.description) + '\n\n');

        // 备注
        if (doc.note) {
            markdown.appendMarkdown(`---\n\n`);
            markdown.appendMarkdown(`> 💡 ${escapeMd(doc.note)}\n\n`);
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
