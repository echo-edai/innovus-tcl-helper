/**
 * Copilot AI 集成 — Language Model Tools
 *
 * 架构说明:
 *   LM Tool 不是"调用 AI"，而是"被 AI 调用"。
 *   Copilot 的 AI 模型在需要 Innovus 领域知识时，自动调用这些工具获取上下文。
 *   工具返回原始数据（脚本内容 + 完整命令文档），AI 模型基于这些上下文进行推理分析。
 *
 * 注册 3 个工具:
 *   1. innovus_list_commands    — 列出/搜索 Innovus TCL 命令
 *   2. innovus_get_command_help — 获取指定命令的完整文档
 *   3. innovus_parse_tcl_script — 解析 TCL 脚本，返回【脚本+命令文档+参数映射】上下文
 *
 * 设计目标: 帮助 Copilot 写出低幻觉的 Innovus TCL 代码。
 *   工具提供事实（命令文档），AI 模型负责推理（分析、总结、建议）。
 */

import * as vscode from 'vscode';
import { getDB, CmdInfo } from './commands';

// ════════════════════════════════════════════════════════════════
//  通用工具函数
// ════════════════════════════════════════════════════════════════

/** 编辑距离 */
function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (m === 0) { return n; }
    if (n === 0) { return m; }
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            curr[j] = a[i - 1] === b[j - 1]
                ? prev[j - 1]
                : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

/** 从行文本中提取 -flag 参数及其值 */
function extractParamsFromLine(line: string): Map<string, string | null> {
    const params = new Map<string, string | null>();
    const tokens = line.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith('-')) {
            const flag = t.replace(/[,;]$/, '');
            if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
                let val = tokens[i + 1].replace(/[,;]$/, '');
                val = val.replace(/^\{/, '').replace(/\}$/, '');
                params.set(flag, val);
                i++;
            } else {
                params.set(flag, null);
            }
        }
    }
    return params;
}

// ════════════════════════════════════════════════════════════════
//  Tool 1: innovus_list_commands — 列出/搜索 Innovus 命令
// ════════════════════════════════════════════════════════════════

class ListCommandsTool implements vscode.LanguageModelTool<{
    search?: string;
    limit?: number;
}> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{
            search?: string;
            limit?: number;
        }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const db = getDB();
        const input = options.input;
        const search = input.search?.toLowerCase() || '';
        const limit = Math.min(input.limit || 50, 200);

        let commands: string[];
        if (search) {
            const allNames = db.getCommandNames();
            commands = [];
            for (const name of allNames) {
                if (name.toLowerCase().includes(search)) {
                    commands.push(name);
                    if (commands.length >= limit) { break; }
                }
            }
        } else {
            commands = db.getCommandNames().slice(0, limit);
        }

        const isZh = db.getLanguage() === 'zh';
        const total = db.getCommandNames().length;

        let resultText = isZh
            ? `Innovus TCL 命令列表 (共 ${total} 条`
            : `Innovus TCL Command List (${total} total`;
        if (search) {
            resultText += isZh
                ? `, 搜索 "${search}", 匹配 ${commands.length} 条`
                : `, search "${search}", ${commands.length} matched`;
        } else {
            resultText += isZh
                ? `, 显示前 ${commands.length} 条`
                : `, showing first ${commands.length}`;
        }
        resultText += '):\n\n';

        for (const cmdName of commands) {
            const info = db.get(cmdName);
            if (info) {
                const summary = info.summary ? ` — ${info.summary}` : '';
                const typeTag = info.is_cmd !== false
                    ? (isZh ? '[命令]' : '[Cmd]')
                    : (isZh ? '[变量/模式]' : '[Var/Mode]');
                resultText += `- \`${cmdName}\` ${typeTag}${summary}\n`;
            } else {
                resultText += `- \`${cmdName}\`\n`;
            }
        }

        if (commands.length < total && !search) {
            resultText += isZh
                ? `\n... 还有 ${total - commands.length} 条命令。使用 search 参数缩小范围。`
                : `\n... ${total - commands.length} more commands. Use search parameter.`;
        }

        resultText += '\n' + (isZh
            ? '💡 使用 innovus_get_command_help 获取命令的完整语法和参数文档。'
            : '💡 Use innovus_get_command_help for full syntax and parameter docs.');

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(resultText)
        ]);
    }
}

// ════════════════════════════════════════════════════════════════
//  Tool 2: innovus_get_command_help — 获取命令完整文档
// ════════════════════════════════════════════════════════════════

class GetCommandHelpTool implements vscode.LanguageModelTool<{
    command: string;
}> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{
            command: string;
        }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const db = getDB();
        const cmdName = options.input.command?.trim();
        if (!cmdName) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    db.getLanguage() === 'zh'
                        ? '错误：请提供要查询的命令名。'
                        : 'Error: Please provide a command name.'
                )
            ]);
        }

        const info = db.get(cmdName);
        if (!info) {
            const suggestions = this.findSimilar(cmdName, db.getCommandNames());
            const isZh = db.getLanguage() === 'zh';
            let msg = isZh
                ? `未找到命令 "${cmdName}"。`
                : `Command "${cmdName}" not found.`;
            if (suggestions.length > 0) {
                msg += '\n\n' + (isZh ? '你是否想找:\n' : 'Did you mean:\n');
                msg += suggestions.map(s => `- \`${s}\``).join('\n');
            }
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(msg)
            ]);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(this.formatCommandDoc(info))
        ]);
    }

    /** 格式化命令完整文档（供 AI 理解的结构化文本） */
    private formatCommandDoc(info: CmdInfo): string {
        const db = getDB();
        const isZh = db.getLanguage() === 'zh';
        let doc = '';

        const typeLabel = info.is_cmd !== false
            ? (isZh ? '命令' : 'Command')
            : (isZh ? '模式/变量设置' : 'Mode/Variable Setting');
        doc += `## \`${info.command}\` [${typeLabel}]\n\n`;

        if (info.summary) {
            doc += `**${isZh ? '功能摘要' : 'Summary'}:** ${info.summary}\n\n`;
        }
        if (info.usage) {
            doc += `**${isZh ? '语法' : 'Syntax'}:**\n\`\`\`tcl\n${info.usage}\n\`\`\`\n\n`;
        }
        if (info.description && info.description !== info.summary) {
            doc += `**${isZh ? '详细说明' : 'Description'}:**\n${info.description}\n\n`;
        }
        if (info.options && info.options.length > 0) {
            doc += `**${isZh ? '参数列表' : 'Options'} (${info.options.length}):**\n\n`;
            doc += isZh
                ? '| 参数 | 类型 | 必需 | 说明 |\n|------|------|------|------|\n'
                : '| Option | Type | Required | Description |\n|--------|------|----------|-------------|\n';
            for (const opt of info.options) {
                const reqMark = opt.required ? (isZh ? '✅ 必需' : '✅ Required') : (isZh ? '可选' : 'Optional');
                const desc = opt.description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
                doc += `| \`${opt.name}\` | \`${opt.type}\` | ${reqMark} | ${desc} |\n`;
            }
            doc += '\n';
        }

        doc += '---\n';
        doc += (isZh
            ? '**参数类型说明:** `flag`=开关(无需值), `string`=字符串, `int`=整数, `float`=浮点数, `enum`=枚举(有预设值), `point`=坐标(如 {x y})。\n'
            : '**Type Guide:** `flag`=no value, `string`=string, `int`=integer, `float`=float, `enum`=preset choices, `point`=coordinates (e.g. {x y}).\n');
        return doc;
    }

    private findSimilar(target: string, candidates: string[]): string[] {
        const lower = target.toLowerCase();
        const scored: { name: string; score: number }[] = [];
        for (const name of candidates) {
            if (name.toLowerCase().startsWith(lower)) {
                scored.push({ name, score: 0 });
                if (scored.length >= 5) { break; }
            }
        }
        if (scored.length < 3) {
            for (const name of candidates) {
                if (name.toLowerCase().includes(lower) && !scored.some(s => s.name === name)) {
                    scored.push({ name, score: 1 });
                    if (scored.length >= 5) { break; }
                }
            }
        }
        if (scored.length < 3) {
            for (const name of candidates) {
                const dist = levenshtein(lower, name.toLowerCase());
                if (dist <= 3 && dist > 0 && !scored.some(s => s.name === name)) {
                    scored.push({ name, score: dist + 2 });
                    if (scored.length >= 5) { break; }
                }
            }
        }
        return scored.sort((a, b) => a.score - b.score).slice(0, 5).map(s => s.name);
    }
}

// ════════════════════════════════════════════════════════════════
//  Tool 3: innovus_parse_tcl_script — 核心上下文提供工具
//
//  ★ 设计原则:
//    此工具不自己做 AI 分析。它只做一件事：为 Copilot AI 模型提供
//    【最大化的准确上下文】。返回内容包括:
//      A. 脚本全文
//      B. 概览统计
//      C. 每个 Innovus 命令的【完整参考文档】
//      D. 每个命令行中【实际使用的参数对照表】(按命令行逐行匹配)
//      E. 模式/变量设置
//      F. 未识别标识符
//      G. AI 分析任务指引（告诉 Copilot 的 AI 模型如何分析）
//
//    Copilot 的 AI 模型拿到这些上下文后，自行完成:
//      脚本目的概括 → 命令逐条分析 → 参数正确性校验 → 流程评估 → 改进建议
// ════════════════════════════════════════════════════════════════

class ParseTclScriptTool implements vscode.LanguageModelTool<{
    script_content?: string;
    script_uri?: string;
}> {
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{
            script_content?: string;
            script_uri?: string;
        }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const db = getDB();
        let content: string;
        let sourceLabel: string;

        // --- 1. 获取脚本内容 ---
        if (options.input.script_content) {
            content = options.input.script_content;
            sourceLabel = db.getLanguage() === 'zh' ? '用户提供的脚本' : 'user-provided script';
        } else if (options.input.script_uri) {
            try {
                const uri = vscode.Uri.parse(options.input.script_uri);
                const doc = await vscode.workspace.openTextDocument(uri);
                content = doc.getText();
                sourceLabel = uri.fsPath || options.input.script_uri;
            } catch {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        db.getLanguage() === 'zh'
                            ? `错误：无法读取文件 "${options.input.script_uri}"。`
                            : `Error: Cannot read file "${options.input.script_uri}".`
                    )
                ]);
            }
        } else {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'tcl') {
                content = editor.document.getText();
                sourceLabel = editor.document.uri.fsPath || (db.getLanguage() === 'zh' ? '当前编辑器' : 'current editor');
            } else {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        db.getLanguage() === 'zh'
                            ? '错误：请提供 script_content 或 script_uri，或打开一个 TCL 文件。'
                            : 'Error: Provide script_content or script_uri, or open a TCL file.'
                    )
                ]);
            }
        }

        // --- 2. 构建上下文 ---
        const context = buildScriptContext(content, db, sourceLabel);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(context)
        ]);
    }
}

// ════════════════════════════════════════════════════════════════
//  脚本上下文构建器
// ════════════════════════════════════════════════════════════════

interface CommandCall {
    lineNumber: number;
    lineText: string;
    params: Map<string, string | null>;
}

function buildScriptContext(
    content: string,
    db: ReturnType<typeof getDB>,
    sourceLabel: string,
    includeAiTask: boolean = true
): string {
    const isZh = db.getLanguage() === 'zh';
    const lines = content.split('\n');

    // 按行解析
    const commandCalls = new Map<string, CommandCall[]>();
    const modeVariableUses = new Map<string, string[]>();
    const unknownTokens = new Map<string, number>();
    const tclBuiltins = new Map<string, number>();
    let commentLines = 0;
    let blankLines = 0;

    const TCL_BUILTINS = new Set([
        'set', 'puts', 'if', 'else', 'elseif', 'for', 'foreach', 'while',
        'proc', 'return', 'source', 'eval', 'expr', 'switch', 'catch',
        'error', 'uplevel', 'upvar', 'global', 'variable', 'namespace',
        'package', 'array', 'list', 'lindex', 'llength', 'lappend',
        'concat', 'split', 'join', 'string', 'regexp', 'regsub',
        'open', 'close', 'read', 'write', 'gets', 'file', 'cd', 'pwd',
        'exec', 'after', 'vwait', 'bind', 'trace', 'rename', 'interp',
        'clock', 'info', 'scan', 'format', 'binary', 'encoding',
        'fconfigure', 'socket', 'incr', 'append', 'lrange', 'lsearch',
        'lsort', 'break', 'continue', 'dict', 'lassign', 'lset', 'subst', 'unset'
    ]);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) { blankLines++; continue; }
        if (trimmed.startsWith('#')) { commentLines++; continue; }

        const firstToken = trimmed.split(/\s/)[0];
        if (!firstToken.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) { continue; }

        if (TCL_BUILTINS.has(firstToken)) {
            tclBuiltins.set(firstToken, (tclBuiltins.get(firstToken) || 0) + 1);
            continue;
        }

        if (db.isCommand(firstToken)) {
            const params = extractParamsFromLine(trimmed);
            const call: CommandCall = { lineNumber: i + 1, lineText: trimmed, params };
            const existing = commandCalls.get(firstToken);
            if (existing) { existing.push(call); }
            else { commandCalls.set(firstToken, [call]); }
        } else if (db.isKnown(firstToken)) {
            const uses = modeVariableUses.get(firstToken) || [];
            uses.push(trimmed);
            modeVariableUses.set(firstToken, uses);
        } else {
            unknownTokens.set(firstToken, (unknownTokens.get(firstToken) || 0) + 1);
        }
    }

    // ===== 构建输出 =====
    let ctx = '';

    // --- A: 脚本全文 ---
    ctx += isZh
        ? '# 📄 TCL 脚本上下文（供 AI 分析）\n\n'
        : '# 📄 TCL Script Context (for AI Analysis)\n\n';
    ctx += (isZh ? `**来源:** ${sourceLabel}\n\n` : `**Source:** ${sourceLabel}\n\n`);
    ctx += isZh ? '## 1. 脚本全文\n\n' : '## 1. Full Script\n\n';
    ctx += '```tcl\n' + content + '\n```\n\n';

    // --- B: 概览统计 ---
    const effectiveLines = lines.length - commentLines - blankLines;
    const cmdTypeCount = commandCalls.size;
    const cmdTotalCalls = Array.from(commandCalls.values()).reduce((s, v) => s + v.length, 0);

    ctx += isZh ? '## 2. 概览统计\n\n' : '## 2. Overview\n\n';
    ctx += isZh
        ? `- 总行数: ${lines.length} (代码 ${effectiveLines} + 注释 ${commentLines} + 空行 ${blankLines})\n`
        : `- Total: ${lines.length} lines (${effectiveLines} code + ${commentLines} comments + ${blankLines} blank)\n`;
    ctx += isZh
        ? `- Innovus 命令: ${cmdTypeCount} 种 (共 ${cmdTotalCalls} 次调用)\n`
        : `- Innovus Commands: ${cmdTypeCount} types (${cmdTotalCalls} calls)\n`;
    ctx += isZh
        ? `- 模式/变量设置: ${modeVariableUses.size} 个\n`
        : `- Mode/Variable Settings: ${modeVariableUses.size}\n`;
    if (unknownTokens.size > 0) {
        const ut = Array.from(unknownTokens.values()).reduce((s, v) => s + v, 0);
        ctx += isZh
            ? `- ⚠️ 未识别标识符: ${unknownTokens.size} 个 (${ut} 次)\n`
            : `- ⚠️ Unrecognized: ${unknownTokens.size} tokens (${ut} occurrences)\n`;
    }
    ctx += '\n';

    // --- C: 每个命令的完整文档 + 参数使用对照 ---
    if (commandCalls.size > 0) {
        ctx += isZh
            ? '## 3. Innovus 命令完整文档 & 参数使用对照\n\n'
            : '## 3. Innovus Command Docs & Parameter Usage\n\n';
        ctx += (isZh
            ? '> ⚠️ **AI 注意:** 以下每个命令均提供【完整参考文档】和【脚本中每行的参数对照表】。\n'
            : '> ⚠️ **AI Note:** Each command below provides [Full Reference Doc] and [Per-line Parameter Comparison].\n');
        ctx += (isZh
            ? '> 请严格基于文档内容分析：用法是否正确？参数是否完整？是否缺失必需参数？参数类型是否匹配？\n\n'
            : '> Analyze strictly based on docs: correct usage? complete params? missing required? type matches?\n\n');

        const sortedCmds = Array.from(commandCalls.entries())
            .sort((a, b) => b[1].length - a[1].length);

        for (const [cmdName, calls] of sortedCmds) {
            const info = db.get(cmdName);
            if (!info) { continue; }

            ctx += `---\n\n`;
            ctx += `### \`${cmdName}\` — ${isZh ? '调用' : 'called'} ${calls.length} ${isZh ? '次' : 'time(s)'}\n\n`;

            // 完整参考文档
            ctx += isZh ? '#### 📖 完整参考文档\n\n' : '#### 📖 Full Reference Doc\n\n';
            if (info.summary) {
                ctx += `**${isZh ? '功能' : 'Function'}:** ${info.summary}\n\n`;
            }
            if (info.usage) {
                ctx += `**${isZh ? '语法' : 'Syntax'}:** \`${info.usage}\`\n\n`;
            }
            if (info.description && info.description !== info.summary) {
                ctx += `${info.description}\n\n`;
            }
            if (info.options && info.options.length > 0) {
                ctx += isZh ? '**所有参数:**\n\n' : '**All Options:**\n\n';
                ctx += isZh
                    ? '| 参数 | 类型 | 必需 | 说明 |\n|------|------|------|------|\n'
                    : '| Option | Type | Required | Description |\n|--------|------|----------|-------------|\n';
                for (const opt of info.options) {
                    const reqMark = opt.required ? (isZh ? '✅必需' : '✅Req') : (isZh ? '可选' : 'Opt');
                    const desc = opt.description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
                    ctx += `| \`${opt.name}\` | \`${opt.type}\` | ${reqMark} | ${desc} |\n`;
                }
                ctx += '\n';
            }

            // 脚本中每行的实际使用 + 参数对照
            ctx += isZh ? '#### 📝 脚本中实际使用 & 参数对照\n\n' : '#### 📝 Actual Usage & Parameter Comparison\n\n';
            for (let ci = 0; ci < calls.length; ci++) {
                const call = calls[ci];
                ctx += isZh
                    ? `**调用 #${ci + 1}** (第 ${call.lineNumber} 行):\n`
                    : `**Call #${ci + 1}** (line ${call.lineNumber}):\n`;
                ctx += '```tcl\n' + call.lineText + '\n```\n';

                if (info.options && info.options.length > 0) {
                    ctx += isZh ? '**参数使用对照:**\n\n' : '**Parameter Comparison:**\n\n';
                    ctx += isZh
                        ? '| 参数 | 状态 | 脚本中的值 | 文档类型 |\n|------|------|-----------|------|\n'
                        : '| Option | Status | Value in Script | Doc Type |\n|--------|--------|-----------------|----------|\n';

                    const usedFlags = new Set(call.params.keys());
                    for (const opt of info.options) {
                        if (usedFlags.has(opt.name)) {
                            const rawVal = call.params.get(opt.name);
                            const displayVal = rawVal
                                ? `\`${rawVal.length > 40 ? rawVal.substring(0, 37) + '...' : rawVal}\``
                                : (isZh ? '(开关)' : '(flag)');
                            ctx += isZh
                                ? `| \`${opt.name}\` | ✅ 已使用 | ${displayVal} | \`${opt.type}\` |\n`
                                : `| \`${opt.name}\` | ✅ Used | ${displayVal} | \`${opt.type}\` |\n`;
                        } else if (opt.required) {
                            ctx += isZh
                                ? `| \`${opt.name}\` | ❌ **缺失(必需!)** | — | \`${opt.type}\` |\n`
                                : `| \`${opt.name}\` | ❌ **MISSING (Required!)** | — | \`${opt.type}\` |\n`;
                        } else {
                            ctx += isZh
                                ? `| \`${opt.name}\` | — 未使用(可选) | — | \`${opt.type}\` |\n`
                                : `| \`${opt.name}\` | — Not used (optional) | — | \`${opt.type}\` |\n`;
                        }
                    }
                    ctx += '\n';
                }
            }

            // 参数类型速查
            ctx += (isZh
                ? `*类型: flag=开关(无需值) string=字符串 int=整数 float=浮点数 enum=枚举(预设值) point=坐标*\n\n`
                : `*Types: flag=no value string=string int=integer float=float enum=preset point=coordinates*\n\n`);
        }
    }

    // --- D: 模式/变量 ---
    if (modeVariableUses.size > 0) {
        ctx += `---\n\n`;
        ctx += isZh ? '## 4. 模式/变量设置\n\n' : '## 4. Mode/Variable Settings\n\n';
        for (const [name, uses] of modeVariableUses) {
            const info = db.get(name);
            const summary = info?.summary ? ` — ${info.summary}` : '';
            ctx += `- \`${name}\`${summary}: 使用 ${uses.length} ${isZh ? '次' : 'time(s)'}\n`;
            for (const u of uses) {
                ctx += `  \`\`\`tcl\n  ${u}\n  \`\`\`\n`;
            }
        }
        ctx += '\n';
    }

    // --- E: 未识别标识符 ---
    if (unknownTokens.size > 0) {
        ctx += `---\n\n`;
        ctx += isZh ? '## 5. 未识别标识符\n\n' : '## 5. Unrecognized Tokens\n\n';
        ctx += (isZh
            ? '以下不在 Innovus 已知命令库中（可能是用户自定义 proc）:\n\n'
            : 'Not in Innovus command DB (may be user-defined procs):\n\n');
        const sortedUnknown = Array.from(unknownTokens.entries()).sort((a, b) => b[1] - a[1]);
        for (const [name, count] of sortedUnknown) {
            ctx += `- \`${name}\`: ${count} ${isZh ? '次' : 'time(s)'}\n`;
        }
        ctx += '\n';
    }

    // --- F: AI 分析任务指引 (仅当 includeAiTask=true) ---
    if (includeAiTask) {
        ctx += `---\n\n`;
        ctx += isZh
            ? '## 6. 🤖 AI 分析任务\n\n'
            : '## 6. 🤖 AI Analysis Task\n\n';

        // 检查是否有用户自定义提示词
        const cfg = vscode.workspace.getConfiguration('innovus-tcl');
        const customPrompt = cfg.get<string>('aiPrompt', '');

        if (customPrompt) {
            ctx += (isZh
                ? '**（使用自定义提示词）**\n\n'
                : '**（Using custom prompt）**\n\n');
            ctx += customPrompt + '\n\n';
        } else {
            ctx += (isZh
                ? '**请基于以上全部上下文，完成以下分析:**\n\n'
                : '**Based on ALL the context above, complete the following analysis:**\n\n');
            ctx += (isZh
                ? '### A. 脚本整体目的\n用 2-3 句话概括此 TCL 脚本的设计目标和工作流程。\n\n'
                : '### A. Overall Purpose\nSummarize the design goal and workflow in 2-3 sentences.\n\n');
            ctx += (isZh
                ? '### B. 命令逐条分析\n对每个 Innovus 命令说明:\n- 在此脚本中的具体作用\n- 参数使用是否正确（对照上面提供的文档）\n- 是否有缺失的必需参数（上面 ❌ 标注的行）\n- 参数值类型是否匹配文档定义\n\n'
                : '### B. Per-Command Analysis\nFor each Innovus command:\n- What it does in this script\n- Are parameters correct (compare with docs above)\n- Missing required params (lines marked ❌ above)\n- Do param values match the documented types\n\n');
            ctx += (isZh
                ? '### C. 流程评估\n- 命令执行顺序是否合理？\n- 是否存在依赖关系问题？\n- 是否有可优化的地方？\n\n'
                : '### C. Flow Assessment\n- Is execution order logical?\n- Any dependency issues?\n- Optimization opportunities?\n\n');
            ctx += (isZh
                ? '### D. 改进建议\n- 对缺失必需参数的行，给出具体的补充示例\n- 如有更优的命令或参数组合，建议替代方案\n- 标注潜在错误或风险\n\n'
                : '### D. Suggestions\n- For missing required params, give specific fix examples\n- If better commands/params exist, suggest alternatives\n- Flag potential errors or risks\n\n');
            ctx += (isZh
                ? '**⚠️ 关键约束:** 以上已提供每个命令的完整参考文档和逐行参数对照。请严格依据这些文档分析，**不要猜测或编造**命令的参数。如果某参数在文档中不存在，请明确指出。\n'
                : '**⚠️ Critical:** Full reference docs and per-line parameter comparison are provided above. Base analysis STRICTLY on these docs. Do NOT guess or fabricate parameters. If a parameter is not in the docs, point it out.\n');
        }
    } // end includeAiTask

    return ctx;
}

// ════════════════════════════════════════════════════════════════
//  导出
// ════════════════════════════════════════════════════════════════

export const TOOL_DEFINITIONS = {
    listCommands: {
        name: 'innovus_list_commands',
        description: '列出/搜索 Cadence Innovus EDA 工具的 TCL 命令。返回命令名、摘要和类型。AI 编写 Innovus TCL 脚本时必须先查此工具获取正确的命令名，严禁编造不存在的命令。',
        inputSchema: {
            type: 'object',
            properties: {
                search: { type: 'string', description: '可选关键词搜索，如 "addInst", "route", "floorplan"。' },
                limit: { type: 'number', description: '返回最大数量。默认 50，最大 200。' }
            }
        } as object,
        tags: ['innovus', 'tcl', 'eda', 'cadence']
    },
    getCommandHelp: {
        name: 'innovus_get_command_help',
        description: '获取 Cadence Innovus 某个 TCL 命令的完整参考文档：功能摘要、语法、所有参数（名称/类型/必需性/说明）。AI 调用 Innovus 命令前必须先用此工具确认正确的参数名和用法，避免幻觉。',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '要查询的 Innovus TCL 命令名（精确名称），如 "addInst", "routeDesign"。' }
            },
            required: ['command']
        } as object,
        tags: ['innovus', 'tcl', 'eda', 'cadence']
    },
    parseTclScript: {
        name: 'innovus_parse_tcl_script',
        description: '解析 Innovus TCL 脚本，返回【脚本全文 + 所有命令的完整文档 + 每行参数使用对照表】。AI 拿到此上下文后应基于文档事实自行推理分析：脚本目的、命令正确性、缺失参数、流程评估、改进建议。',
        inputSchema: {
            type: 'object',
            properties: {
                script_content: { type: 'string', description: 'TCL 脚本完整文本。' },
                script_uri: { type: 'string', description: '脚本文件 URI。' }
            }
        } as object,
        tags: ['innovus', 'tcl', 'eda', 'cadence']
    }
};

/** 注册所有 LM 工具到 VS Code */
export function registerAllTools(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.lm.registerTool(TOOL_DEFINITIONS.listCommands.name, new ListCommandsTool())
    );
    context.subscriptions.push(
        vscode.lm.registerTool(TOOL_DEFINITIONS.getCommandHelp.name, new GetCommandHelpTool())
    );
    context.subscriptions.push(
        vscode.lm.registerTool(TOOL_DEFINITIONS.parseTclScript.name, new ParseTclScriptTool())
    );
    console.log('[Innovus TCL] 已注册 3 个 Copilot LM Tools');
}

/**
 * 构建脚本上下文（供 extension.ts 的 analyzeScript 命令使用）。
 * 返回 Markdown 格式的完整上下文文本。
 */
export function buildScriptContextForCommand(content: string, sourceLabel?: string, includeAiTask?: boolean): string {
    const db = getDB();
    return buildScriptContext(content, db, sourceLabel || (db.getLanguage() === 'zh' ? '当前脚本' : 'current script'), includeAiTask);
}
