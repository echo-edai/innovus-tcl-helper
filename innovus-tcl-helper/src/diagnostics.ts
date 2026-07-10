/**
 * Diagnostics Provider - TCL 语法静态检查 + Innovus 命令参数校验
 *
 * 三级检查（由 innovus-tcl.diagnosticLevel 配置控制）:
 *   "basic"    — 括号匹配、引号匹配
 *   "standard" — basic + 命令参数必需性检查
 *   "strict"   — standard + 相似命令建议 + 参数类型验证 + 重复参数检测
 */

import * as vscode from 'vscode';
import { getDB } from './commands';

type DiagnosticLevel = 'basic' | 'standard' | 'strict';

/** 解析当前语言设置（与 extension.ts 中 resolveLanguage 一致） */
function resolveDiagnosticLanguage(): 'zh' | 'en' {
    const configLang = vscode.workspace.getConfiguration('innovus-tcl')
        .get<string>('language', 'auto');
    if (configLang === 'auto') {
        const vsLang = vscode.env.language.toLowerCase();
        return vsLang.startsWith('zh') ? 'zh' : 'en';
    }
    return configLang === 'zh' ? 'zh' : 'en';
}

export class TclDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    // TCL 9.0 内置命令全集（按功能分类）
    // 用于跳过 Innovus 命令校验，避免将标准 TCL 命令误报为"未知命令"
    private static readonly TCL_BUILTINS = new Set([
        // ── 核心：变量与赋值 ──
        'set', 'unset', 'incr', 'append', 'lappend', 'subst',
        'global', 'variable', 'upvar', 'uplevel',
        'namespace', 'rename',
        // ── 核心：过程与作用域 ──
        'proc', 'return', 'apply', 'tailcall', 'yield', 'yieldto',
        'coroutine', 'coroinject', 'coroprobe',
        // ── 核心：求值与源文件 ──
        'eval', 'expr', 'source',
        // ── 控制流 ──
        'if', 'else', 'elseif', 'switch', 'for', 'foreach', 'while',
        'break', 'continue', 'try', 'throw', 'catch', 'error',
        // ── 列表操作 ──
        'list', 'concat', 'join', 'split', 'lindex', 'llength',
        'lsearch', 'lsort', 'lrange', 'lreplace', 'linsert', 'lset',
        'lassign', 'lrepeat', 'lreverse', 'lmap', 'lpop', 'lremove', 'ledit',
        'lseq',
        // ── 字典操作 ──
        'dict',
        // ── 数组操作 ──
        'array', 'parray',
        // ── 字符串操作 ──
        'string', 'format', 'scan', 'regexp', 'regsub',
        // ── 文件 I/O ──
        'open', 'close', 'read', 'write', 'gets', 'puts', 'seek', 'tell',
        'eof', 'flush', 'fconfigure', 'fcopy', 'fblocked', 'fileevent',
        'readFile', 'writeFile',
        // ── 文件系统 ──
        'file', 'glob', 'cd', 'pwd', 'filename',
        // ── 进程与系统 ──
        'exec', 'pid', 'exit', 'socket', 'chan', 'transchan', 'refchan',
        // ── 时间与事件 ──
        'after', 'clock', 'time', 'timerate', 'vwait', 'update',
        // ── 包管理 ──
        'package', 'load', 'unload', 'pkg_mkIndex', 'pkg::create',
        // ── 信息与内省 ──
        'info', 'encoding', 'binary',
        // ── 环境与配置 ──
        'env', 'configure',
        // ── 跟踪与调试 ──
        'trace', 'interp', 'history', 'memory',
        // ── 错误处理 ──
        'bgerror', 'errorCode', 'errorInfo',
        // ── Tcl 平台变量 ──
        'tcl_version', 'tcl_patchLevel', 'tcl_pkgPath', 'tcl_platform',
        'tcl_library', 'tcl_interactive', 'tcl_rcFileName',
        'tcl_nonwordchars', 'tcl_wordchars',
        'tcl_startOfNextWord', 'tcl_startOfPreviousWord',
        'tcl_endOfWord', 'tcl_wordBreakAfter', 'tcl_wordBreakBefore',
        'tcl_traceCompile', 'tcl_traceExec', 'tcl_findLibrary',
        // ── 全局变量 ──
        'env', 'argc', 'argv', 'argv0', 'auto_path',
        'auto_execok', 'auto_import', 'auto_load',
        'auto_mkindex', 'auto_qualify', 'auto_reset',
        // ── OOP (TclOO) ──
        'oo::class', 'oo::define', 'oo::objdefine', 'oo::object',
        'oo::abstract', 'oo::singleton', 'oo::configurable',
        'oo::copy', 'oo::Slot',
        'my', 'myclass', 'mymethod', 'self', 'next', 'nextto',
        'classvariable', 'const', 'property',
        // ── 压缩 ──
        'zipfs', 'zlib',
        // ── 杂项 ──
        'unknown', 're_syntax', 'callback', 'safe', 'tcltest',
        'tm', 'platform', 'platform::shell', 'link', 'dde',
        'registry', 'http', 'cookiejar', 'msgcat',
        'tcl::idna', 'tcl::prefix', 'tcl::process',
        'Tcl', 'buildinfo',
        'fpclassify', 'mathfunc', 'mathop', 'tcl::mathop',
    ]);

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('innovus-tcl');
    }

    /** 获取当前诊断级别 */
    private getLevel(): DiagnosticLevel {
        return vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('diagnosticLevel', 'standard') as DiagnosticLevel;
    }

    /** 对整个文档进行诊断 */
    updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'tcl') { return; }

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const db = getDB();
        const level = this.getLevel();

        // 1. 括号匹配检查（所有级别）
        this.checkBrackets(document, text, diagnostics);

        // 2. 引号匹配检查（所有级别）
        this.checkQuotes(document, text, diagnostics);

        // 3. 命令参数检查（standard + strict）
        if (level !== 'basic') {
            this.checkCommandArgs(document, text, diagnostics, db, level);
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /** 括号匹配检查 - 适配 TCL 的 [] {} 语法 */
    private checkBrackets(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const isZh = resolveDiagnosticLanguage() === 'zh';
        const lines = text.split('\n');
        let braceDepth = 0;
        let bracketDepth = 0;
        let inString = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // 跳过纯注释行
            if (line.trimStart().startsWith('#')) { continue; }

            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                const prevCh = j > 0 ? line[j - 1] : '';

                // 跳过转义字符
                if (ch === '\\' && j + 1 < line.length) {
                    j++;
                    continue;
                }

                // 双引号字符串状态跟踪
                if (ch === '"' && prevCh !== '\\') {
                    inString = !inString;
                    continue;
                }

                // 跳过注释（不在字符串中）
                if (!inString && ch === '#' && prevCh !== '\\') {
                    break; // 行内注释，跳过剩余
                }

                // 字符串内的括号不计数（TCL 中字符串内的 [] 不会被执行）
                if (inString) { continue; }

                if (ch === '[') { bracketDepth++; }
                if (ch === ']') { bracketDepth--; }
                if (ch === '{') { braceDepth++; }
                if (ch === '}') { braceDepth--; }

                if (bracketDepth < 0) {
                    diagnostics.push(this.createDiagnostic(
                        document, i, j, j + 1,
                        isZh
                            ? '多余的右方括号 "]" — 没有匹配的左方括号'
                            : 'Extra "]" — no matching "[" found',
                        vscode.DiagnosticSeverity.Error
                    ));
                    bracketDepth = 0;
                }
                if (braceDepth < 0) {
                    diagnostics.push(this.createDiagnostic(
                        document, i, j, j + 1,
                        isZh
                            ? '多余的右花括号 "}" — 没有匹配的左花括号'
                            : 'Extra "}" — no matching "{" found',
                        vscode.DiagnosticSeverity.Error
                    ));
                    braceDepth = 0;
                }
            }
        }

        if (bracketDepth > 0) {
            const lastLine = lines.length - 1;
            diagnostics.push(this.createDiagnostic(
                document, lastLine, 0, 1,
                isZh
                    ? `缺少 ${bracketDepth} 个右方括号 "]" — 文件末尾仍有未闭合的方括号`
                    : `Missing ${bracketDepth} closing "]" — unclosed bracket(s) at end of file`,
                vscode.DiagnosticSeverity.Error
            ));
        }
        if (braceDepth > 0) {
            const lastLine = lines.length - 1;
            diagnostics.push(this.createDiagnostic(
                document, lastLine, 0, 1,
                isZh
                    ? `缺少 ${braceDepth} 个右花括号 "}" — 文件末尾仍有未闭合的花括号`
                    : `Missing ${braceDepth} closing "}" — unclosed brace(s) at end of file`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    /** 引号匹配检查 */
    private checkQuotes(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const isZh = resolveDiagnosticLanguage() === 'zh';
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trimStart().startsWith('#')) { continue; }

            let inString = false;
            let stringStart = -1;

            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                // 跳过转义字符
                if (ch === '\\' && j + 1 < line.length) {
                    j++;
                    continue;
                }
                if (ch === '"') {
                    if (!inString) {
                        inString = true;
                        stringStart = j;
                    } else {
                        inString = false;
                    }
                }
            }

            if (inString) {
                diagnostics.push(this.createDiagnostic(
                    document, i, stringStart, stringStart + 1,
                    isZh
                        ? '未闭合的双引号 — 字符串从该位置开始到行尾未找到闭合引号'
                        : 'Unclosed double quote — missing closing "\"" before end of line',
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }
    }

    /** Innovus 命令参数检查 + 相似命令建议 */
    private checkCommandArgs(
        document: vscode.TextDocument,
        text: string,
        diagnostics: vscode.Diagnostic[],
        db: ReturnType<typeof getDB>,
        level: DiagnosticLevel
    ): void {
        const isZh = resolveDiagnosticLanguage() === 'zh';
        const rawLines = text.split('\n');
        const allCommandNames = db.getCommandNames();

        // ── 预处理：合并 TCL 反斜杠续行（行尾 \ 表示下一行是续行） ──
        const lines: { text: string; startLine: number }[] = [];
        for (let i = 0; i < rawLines.length; i++) {
            let current = rawLines[i];
            let startLine = i;
            // 如果行尾是 \（可能后有空白），则合并下一行
            while (i < rawLines.length && /\\\s*$/.test(current)) {
                current = current.replace(/\\\s*$/, '') + ' ' + (rawLines[i + 1] || '');
                i++;
            }
            lines.push({ text: current.trim(), startLine });
        }

        for (let li = 0; li < lines.length; li++) {
            const line = lines[li].text;
            const lineIdx = lines[li].startLine;
            if (!line || line.startsWith('#')) { continue; }

            // 跳过 TCL 内置命令
            const firstToken = line.split(/\s/)[0];
            if (TclDiagnosticsProvider.TCL_BUILTINS.has(firstToken)) {
                continue;
            }

            // 提取第一个词作为可能的命令名
            const firstWordMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (!firstWordMatch) { continue; }

            const cmdName = firstWordMatch[1];
            const cmdStartIdx = line.indexOf(cmdName);

            // === 已知命令：检查参数 ===
            if (db.isCommand(cmdName)) {
                const cmdInfo = db.get(cmdName);
                if (cmdInfo && cmdInfo.options) {
                    const parsedArgs = this.parseArguments(line, cmdInfo.options);

                    // 检查重复参数（strict 级别）
                    if (level === 'strict') {
                        const flagCounts = new Map<string, number>();
                        for (const [flag] of parsedArgs) {
                            flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
                        }
                        for (const [flag, count] of flagCounts) {
                            if (count > 1) {
                                const flagIdx = line.lastIndexOf(flag);
                                diagnostics.push(this.createDiagnostic(
                                    document, lineIdx, flagIdx, flagIdx + flag.length,
                                    isZh
                                        ? `参数 ${flag} 重复指定了 ${count} 次`
                                        : `Option ${flag} specified ${count} times (duplicate)`,
                                    vscode.DiagnosticSeverity.Warning
                                ));
                            }
                        }
                    }

                    // 检查必需参数
                    // 先解析 usage 中的互斥参数组
                    const altGroups = cmdInfo.usage
                        ? this.parseAlternativeGroups(cmdInfo.usage)
                        : { mandatory: [] as Set<string>[], optional: [] as Set<string>[] };
                    const allAltGroups = [...altGroups.mandatory, ...altGroups.optional];

                    for (const opt of cmdInfo.options) {
                        if (!opt.required) { continue; }

                        // 跳过已满足的互斥参数组成员（同一组中只要有一个存在即可）
                        if (parsedArgs.has(opt.name)) { continue; }
                        const inSatisfiedGroup = allAltGroups.some(group =>
                            group.has(opt.name) &&
                            [...group].some(member => parsedArgs.has(member))
                        );
                        if (inSatisfiedGroup) { continue; }

                        // 如果属于 optional 互斥组且整组缺失 → 不报错（可选组允许全缺）
                        const inOptionalGroup = altGroups.optional.some(group =>
                            group.has(opt.name)
                        );
                        if (inOptionalGroup) { continue; }

                        // 检查是否为 mandatory 互斥组中唯一缺失的（整组都缺失）
                        const inMandatoryGroup = altGroups.mandatory.some(group =>
                            group.has(opt.name)
                        );
                        if (inMandatoryGroup) {
                            // 找到所属的互斥组，只报告一次（报告组中第一个参数作为代表）
                            for (const group of altGroups.mandatory) {
                                if (group.has(opt.name)) {
                                    const members = [...group];
                                    if (members[0] === opt.name) {
                                        const memberList = members.join(' | ');
                                        diagnostics.push(this.createDiagnostic(
                                            document, lineIdx,
                                            cmdStartIdx, cmdStartIdx + cmdName.length,
                                            isZh
                                                ? `缺少必需参数: {${memberList}} — 必须指定其中之一`
                                                : `Missing required option: {${memberList}} — one must be specified`,
                                            vscode.DiagnosticSeverity.Warning
                                        ));
                                    }
                                    break;
                                }
                            }
                            continue;
                        }

                        // 普通必需参数检查
                        if (!parsedArgs.has(opt.name)) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx,
                                cmdStartIdx, cmdStartIdx + cmdName.length,
                                isZh
                                    ? `缺少必需参数: ${opt.name} — ${opt.description}`
                                    : `Missing required option: ${opt.name} — ${opt.description}`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        } else if (opt.type !== 'flag' && !parsedArgs.get(opt.name)) {
                            const flagIdx = line.indexOf(opt.name);
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx,
                                flagIdx, flagIdx + opt.name.length,
                                isZh
                                    ? `参数 ${opt.name} 需要值 (类型: ${opt.type})`
                                    : `Option ${opt.name} requires a value (type: ${opt.type})`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }

                    // strict 级别：参数值类型检查
                    if (level === 'strict') {
                        this.checkParamTypes(document, lineIdx, line, cmdInfo.options, parsedArgs, diagnostics);
                    }
                }
                continue;
            }

            // === 已知条目（模式变量）：跳过参数校验 ===
            if (db.isKnown(cmdName)) {
                continue;
            }

            // === strict 级别：未知命令 → 相似命令建议 ===
            if (level === 'strict' && cmdName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
                const similar = this.findSimilarCommands(cmdName, allCommandNames);
                if (similar.length > 0) {
                    const suggestions = similar.map(s => `\`${s}\``).join(', ');
                    diagnostics.push(this.createDiagnostic(
                        document, lineIdx,
                        cmdStartIdx, cmdStartIdx + cmdName.length,
                        isZh
                            ? `未知命令 "${cmdName}"。你是否想写: ${suggestions}？`
                            : `Unknown command "${cmdName}". Did you mean: ${suggestions}?`,
                        vscode.DiagnosticSeverity.Information
                    ));
                }
            }
        }
    }

    /** strict 级别：参数值类型验证 */
    private checkParamTypes(
        document: vscode.TextDocument,
        lineIdx: number,
        line: string,
        options: import('./commands').CmdOption[],
        parsedArgs: Map<string, string | null>,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const isZh = resolveDiagnosticLanguage() === 'zh';
        for (const opt of options) {
            const value = parsedArgs.get(opt.name);
            if (value === null || value === undefined) { continue; }

            // 检查类型匹配
            switch (opt.type) {
                case 'int':
                    // 接受整数、[expr ...]、$var、${var}
                    if (!/^-?\d+$/.test(value) &&
                        !/^\s*\[/.test(value) &&
                        !/^\s*\$\w/.test(value)) {
                        const idx = line.indexOf(value);
                        if (idx >= 0) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx, idx, idx + value.length,
                                isZh
                                    ? `${opt.name} 期望整数类型，但得到 "${value}"`
                                    : `${opt.name} expects an integer, got "${value}"`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                    break;
                case 'float':
                    // 接受浮点数、[expr ...]、$var、${var}
                    if (!/^-?\d+\.?\d*$/.test(value) &&
                        !/^\s*\[/.test(value) &&
                        !/^\s*\$\w/.test(value)) {
                        const idx = line.indexOf(value);
                        if (idx >= 0) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx, idx, idx + value.length,
                                isZh
                                    ? `${opt.name} 期望浮点数类型，但得到 "${value}"`
                                    : `${opt.name} expects a float, got "${value}"`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                    break;
                case 'point':
                    // 接受坐标、[expr ...]、$var
                    if (!/^\{?\s*-?\d+\.?\d*\s+-?\d+\.?\d*\s*\}?$/.test(value) &&
                        !/^\s*\[/.test(value) &&
                        !/^\s*\$\w/.test(value)) {
                        const idx = line.indexOf(value);
                        if (idx >= 0) {
                            diagnostics.push(this.createDiagnostic(
                                document, lineIdx, idx, idx + value.length,
                                isZh
                                    ? `${opt.name} 期望坐标类型 (如 "{x y}")，但得到 "${value}"`
                                    : `${opt.name} expects coordinates (e.g. "{x y}"), got "${value}"`,
                                vscode.DiagnosticSeverity.Information
                            ));
                        }
                    }
                    break;
            }
        }
    }

    /**
     * 解析命令行参数，返回 Map<paramName, value | null>。
     * 支持两类参数:
     *   -flag 参数: 名称为 -xxx 形式，值可选跟随（flag 类型值为 null）
     *   <positional> 参数: 名称为 <xxx> 形式，按 options 顺序匹配剩余非 flag token
     *
     * @param line     - 命令行文本
     * @param options  - 命令参数定义（用于识别位置参数及其顺序）
     */
    private parseArguments(line: string, options?: import('./commands').CmdOption[]): Map<string, string | null> {
        const args = new Map<string, string | null>();
        const tokens = this.splitTclArgs(line);
        const consumed = new Set<number>(); // 已被消费的 token 索引

        // ── 第一遍：解析 -flag 参数 ──
        // 构建 option 查找表（用于判断 flag 类型）
        const optionMap = new Map<string, import('./commands').CmdOption>();
        if (options) {
            for (const opt of options) {
                optionMap.set(opt.name, opt);
            }
        }

        for (let idx = 1; idx < tokens.length; idx++) {
            if (consumed.has(idx)) { continue; }
            const token = tokens[idx];
            if (token.startsWith('-')) {
                const cleanFlag = token.replace(/[,;]$/, '');
                consumed.add(idx);
                // 查找该 flag 的定义，判断是否为纯 flag（不取值）
                const optDef = optionMap.get(cleanFlag);
                const isPureFlag = optDef?.type === 'flag';
                if (!isPureFlag && idx + 1 < tokens.length && !tokens[idx + 1].startsWith('-')) {
                    // 非纯 flag：下一个 token 作为值
                    let nextToken = tokens[idx + 1];
                    nextToken = nextToken.replace(/[,;]$/, '');
                    nextToken = nextToken.replace(/^\{/, '').replace(/\}$/, '');
                    args.set(cleanFlag, nextToken);
                    consumed.add(idx + 1);
                    idx++;
                } else {
                    // 纯 flag（或已到末尾）：值为 null 表示存在
                    args.set(cleanFlag, null);
                }
            }
        }

        // ── 第二遍：匹配位置参数（名称以 < 开头的非 flag 选项） ──
        if (options && options.length > 0) {
            const positionalOpts = options.filter(
                o => o.name.startsWith('<') && !o.name.startsWith('-')
            );
            if (positionalOpts.length > 0) {
                let posIdx = 0;
                for (let idx = 1; idx < tokens.length; idx++) {
                    if (consumed.has(idx)) { continue; }
                    if (posIdx >= positionalOpts.length) { break; }
                    const token = tokens[idx];
                    // 跳过 flag 值（已被上一遍标记）和看起来像 flag 的 token
                    if (token.startsWith('-')) { continue; }
                    const cleanToken = token.replace(/[,;]$/, '');
                    args.set(positionalOpts[posIdx].name, cleanToken);
                    consumed.add(idx);
                    posIdx++;
                }
                // 剩余未匹配的位置参数标记为缺失（null）
                for (let pi = posIdx; pi < positionalOpts.length; pi++) {
                    if (!args.has(positionalOpts[pi].name)) {
                        args.set(positionalOpts[pi].name, null);
                    }
                }
            }
        }

        return args;
    }

    /**
     * 按 TCL 语法分割命令行参数，尊重 [...] 和 {...} 的原子性。
     * 例如 "[list $A $B]" 作为一个整体 token，不会被空格拆分。
     */
    private splitTclArgs(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let bracketDepth = 0;
        let braceDepth = 0;
        let inString = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            const prevCh = i > 0 ? line[i - 1] : '';

            // 双引号字符串
            if (ch === '"' && prevCh !== '\\' && braceDepth === 0 && bracketDepth === 0) {
                inString = !inString;
                current += ch;
                continue;
            }

            // 在引号内，直接追加
            if (inString) {
                current += ch;
                continue;
            }

            // 花括号
            if (ch === '{') {
                braceDepth++;
                current += ch;
                continue;
            }
            if (ch === '}') {
                braceDepth = Math.max(0, braceDepth - 1);
                current += ch;
                continue;
            }

            // 方括号
            if (ch === '[') {
                bracketDepth++;
                current += ch;
                continue;
            }
            if (ch === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
                current += ch;
                continue;
            }

            // 反斜杠转义（跳过下一个字符）
            if (ch === '\\' && i + 1 < line.length) {
                current += ch;
                i++;
                current += line[i];
                continue;
            }

            // 空格：在嵌套外部时分割
            if (/\s/.test(ch) && braceDepth === 0 && bracketDepth === 0) {
                if (current.length > 0) {
                    result.push(current);
                    current = '';
                }
                continue;
            }

            current += ch;
        }

        // 最后一个 token
        if (current.length > 0) {
            result.push(current);
        }

        return result;
    }

    /** 使用编辑距离查找相似命令 */
    private findSimilarCommands(target: string, candidates: string[]): string[] {
        const lower = target.toLowerCase();
        const scored: { name: string; score: number }[] = [];

        // 前缀匹配优先
        for (const name of candidates) {
            if (name.toLowerCase().startsWith(lower)) {
                scored.push({ name, score: 0 });
                if (scored.length >= 3) { break; }
            }
        }

        // 包含匹配
        if (scored.length < 3) {
            for (const name of candidates) {
                if (name.toLowerCase().includes(lower) && !scored.some(s => s.name === name)) {
                    scored.push({ name, score: 1 });
                    if (scored.length >= 3) { break; }
                }
            }
        }

        // 编辑距离 ≤ 3
        if (scored.length < 3) {
            for (const name of candidates) {
                const dist = levenshtein(lower, name.toLowerCase());
                if (dist <= 3 && dist > 0 && !scored.some(s => s.name === name)) {
                    scored.push({ name, score: dist + 2 });
                    if (scored.length >= 3) { break; }
                }
            }
        }

        return scored.sort((a, b) => a.score - b.score).slice(0, 3).map(s => s.name);
    }

    /**
     * 从 usage 字符串中解析互斥参数组。
     * 支持三种格式:
     *   {-opt1 | -opt2}     — 花括号互斥组（至少选一个）
     *   [-opt1 | -opt2]     — 方括号互斥组（可选，不超过一个）
     *   -opt1 | -opt2       — 末尾裸互斥组（至少选一个）
     *
     * @returns { mandatory, optional } — mandatory 组至少需要一个成员；
     *          optional 组成员全部缺失也不报错
     */
    private parseAlternativeGroups(usage: string): { mandatory: Set<string>[]; optional: Set<string>[] } {
        const mandatory: Set<string>[] = [];
        const optional: Set<string>[] = [];

        // ── 格式 1: {xxx | yyy | zzz} → mandatory ──
        // 使用深度追踪匹配嵌套花括号（如 {-layer {layer | {top ...}}}）
        const braceGroups = this.extractNestedBraces(usage);
        for (const content of braceGroups) {
            if (!content.includes('|')) { continue; }
            const members = content.split('|').map(s => s.trim().split(/\s+/)[0]).filter(s => s.length > 0);
            if (members.length >= 2) {
                mandatory.push(new Set(members));
            }
        }

        // ── 格式 2: [...|...] → optional ──
        let match: RegExpExecArray | null;
        const bracketRegex = /\[([^\]]*\|[^\]]*)\]/g;
        while ((match = bracketRegex.exec(usage)) !== null) {
            const content = match[1];
            if (!content.includes('|')) { continue; }
            const members = content.split('|').map(s => s.trim().split(/\s+/)[0]).filter(s => s.length > 0);
            if (members.length >= 2) {
                optional.push(new Set(members));
            }
        }

        // ── 格式 3: 末尾无括号的 -opt1 | -opt2 → mandatory ──
        const unbracketedRegex = /(?:^|\s)(-[a-zA-Z_][a-zA-Z0-9_]*\s*\|\s*-[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\|\s*-[a-zA-Z_][a-zA-Z0-9_]*)*)\s*$/;
        const ubMatch = usage.match(unbracketedRegex);
        if (ubMatch) {
            const content = ubMatch[1].trim();
            // 确保不在花括号或方括号内
            const openBrace = usage.lastIndexOf('{', ubMatch.index!);
            const closeBrace = usage.lastIndexOf('}', ubMatch.index!);
            const openBracket = usage.lastIndexOf('[', ubMatch.index!);
            const closeBracket = usage.lastIndexOf(']', ubMatch.index!);
            const inBrace = openBrace >= 0 && openBrace > closeBrace;
            const inBracket = openBracket >= 0 && openBracket > closeBracket;
            if (!inBrace && !inBracket) {
                const members = content.split('|').map(s => s.trim().split(/\s+/)[0]).filter(s => s.length > 0);
                if (members.length >= 2) {
                    const memberSet = new Set(members);
                    const isDuplicate = [...mandatory, ...optional].some(g =>
                        g.size === memberSet.size && [...g].every(m => memberSet.has(m))
                    );
                    if (!isDuplicate) {
                        mandatory.push(memberSet);
                    }
                }
            }
        }

        return { mandatory, optional };
    }

    /**
     * 从字符串中提取所有顶层花括号 {...} 组的内容。
     * 正确处理嵌套花括号（深度追踪，不提前截断）。
     */
    private extractNestedBraces(text: string): string[] {
        const results: string[] = [];
        let i = 0;
        while (i < text.length) {
            if (text[i] === '{') {
                let depth = 1;
                let j = i + 1;
                while (j < text.length && depth > 0) {
                    if (text[j] === '{') { depth++; }
                    else if (text[j] === '}') { depth--; }
                    j++;
                }
                if (depth === 0) {
                    // 提取 {...} 内部内容（不含外层花括号）
                    results.push(text.substring(i + 1, j - 1));
                }
                i = j;
            } else {
                i++;
            }
        }
        return results;
    }

    private createDiagnostic(
        document: vscode.TextDocument,
        line: number,
        startChar: number,
        endChar: number,
        message: string,
        severity: vscode.DiagnosticSeverity
    ): vscode.Diagnostic {
        const range = new vscode.Range(line, startChar, line, endChar);
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'Innovus TCL';
        return diagnostic;
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}

/** 编辑距离算法 */
function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) { return n; }
    if (n === 0) { return m; }

    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                curr[j] = prev[j - 1];
            } else {
                curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
            }
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}
