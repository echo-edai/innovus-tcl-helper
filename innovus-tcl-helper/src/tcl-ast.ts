/**
 * TCL AST 解析器 — Tokenizer + Parser
 *
 * 解析 TCL 脚本的关键语法结构:
 *   - set varName value          → 变量赋值
 *   - $varName / ${varName}      → 变量引用
 *   - source file.tcl            → 文件包含
 *   - proc name {args} {body}    → 过程定义
 *   - [command ...]              → 命令替换（括号内嵌命令）
 *   - "string" / {literal}       → 字符串/字面量
 *   - # comment                  → 注释
 *
 * 用于跨文件变量追踪和 Lint 分析。
 */

// ════════════════════════════════════════════════════════════
//  Token 类型定义
// ════════════════════════════════════════════════════════════

export enum TokenType {
    COMMAND = 'COMMAND',         // 命令名（第一个词）
    WORD = 'WORD',               // 普通参数词
    STRING = 'STRING',           // "双引号字符串"
    BRACED = 'BRACED',           // {花括号字面量}
    VARIABLE_REF = 'VAR_REF',    // $varName 或 ${varName}
    NEWLINE = 'NEWLINE',         // 换行（语句分隔符）
    EOF = 'EOF',                 // 文件结束
    SEMICOLON = 'SEMICOLON',     // ; 分号（另一语句分隔符）
    COMMENT = 'COMMENT',         // # 注释
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;       // 1-based
    column: number;     // 1-based
    rawLength: number;  // 原始文本长度
}

// ════════════════════════════════════════════════════════════
//  AST 节点类型定义
// ════════════════════════════════════════════════════════════

/** 变量赋值节点 */
export interface SetNode {
    kind: 'set';
    varName: string;
    valueTokens: Token[];      // 值部分的 tokens（可能包含变量引用等）
    valueText: string;         // 原始值文本
    line: number;
    column: number;
    rawText: string;           // 整行原始文本
}

/** 变量引用节点 */
export interface VarRefNode {
    kind: 'var_ref';
    varName: string;           // 去掉 $ 前缀的变量名
    isBraceForm: boolean;      // ${varName} vs $varName
    line: number;
    column: number;
    rawText: string;
}

/** 文件包含节点 */
export interface SourceNode {
    kind: 'source';
    filePath: string;
    line: number;
    column: number;
    rawText: string;
}

/** 过程定义节点 */
export interface ProcNode {
    kind: 'proc';
    procName: string;
    args: string[];            // 参数名列表（仅参数名，不含默认值）
    bodyStartLine: number;     // body 开始行
    bodyEndLine: number;       // body 结束行
    bodyText: string;          // body 文本内容（去外层花括号）
    line: number;
    column: number;
    rawText: string;
}

/** 通用命令调用节点 */
export interface CommandNode {
    kind: 'command';
    commandName: string;
    args: Token[];
    line: number;
    column: number;
    rawText: string;
}

export type AstNode = SetNode | VarRefNode | SourceNode | ProcNode | CommandNode;

// ════════════════════════════════════════════════════════════
//  解析结果
// ════════════════════════════════════════════════════════════

export interface ParseResult {
    filePath: string;
    nodes: AstNode[];
    // 快速索引
    sets: SetNode[];
    varRefs: VarRefNode[];
    sources: SourceNode[];
    procs: ProcNode[];
    commands: CommandNode[];
    errors: ParseError[];
}

export interface ParseError {
    message: string;
    line: number;
    column: number;
}

// ════════════════════════════════════════════════════════════
//  Tokenizer
// ════════════════════════════════════════════════════════════

/**
 * 将 TCL 文本分解为 token 流。
 * 处理: 双引号字符串、花括号字面量、变量引用、方括号命令替换、注释、续行符。
 */
export function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    const len = text.length;
    let pos = 0;
    let line = 1;
    let col = 1;

    function advance(): string {
        const ch = text[pos];
        pos++;
        if (ch === '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
        return ch;
    }

    function peek(): string {
        return pos < len ? text[pos] : '';
    }

    function peekAhead(n: number): string {
        return pos + n < len ? text[pos + n] : '';
    }

    while (pos < len) {
        const startLine = line;
        const startCol = col;
        const ch = text[pos];

        // 空白
        if (ch === ' ' || ch === '\t' || ch === '\r') {
            advance();
            continue;
        }

        // 换行
        if (ch === '\n') {
            advance();
            tokens.push({ type: TokenType.NEWLINE, value: '\n', line: startLine, column: startCol, rawLength: 1 });
            continue;
        }

        // 分号
        if (ch === ';') {
            advance();
            tokens.push({ type: TokenType.SEMICOLON, value: ';', line: startLine, column: startCol, rawLength: 1 });
            continue;
        }

        // 反斜杠续行
        if (ch === '\\' && peek() === '\n') {
            advance(); // \
            advance(); // \n
            // 跳过续行后的空白
            while (peek() === ' ' || peek() === '\t') {
                advance();
            }
            continue;
        }
        if (ch === '\\' && peek() === '\r' && peekAhead(1) === '\n') {
            advance(); advance(); advance(); // \r\n
            while (peek() === ' ' || peek() === '\t') { advance(); }
            continue;
        }

        // 注释（仅在行首或分号后有效）
        // TCL 中 # 只有在新行开始或分号后才被视为注释起始符
        if (ch === '#') {
            const isFirstToken = tokens.length === 0;
            const lastToken = tokens.length > 0 ? tokens[tokens.length - 1] : null;
            const isAfterNewlineOrSemicolon = lastToken !== null &&
                (lastToken.type === TokenType.NEWLINE || lastToken.type === TokenType.SEMICOLON);

            if (isFirstToken || isAfterNewlineOrSemicolon) {
                // 读取到行尾
                let commentText = '';
                const commentLine = line;
                const commentCol = col;
                while (pos < len && text[pos] !== '\n') {
                    commentText += advance();
                }
                tokens.push({
                    type: TokenType.COMMENT,
                    value: commentText,
                    line: commentLine,
                    column: commentCol,
                    rawLength: commentText.length
                });
                continue;
            }
            // 否则 # 在命令参数中，作为普通字符处理
        }

        // 双引号字符串
        if (ch === '"') {
            const strLine = line;
            const strCol = col;
            advance(); // 跳过开引号
            let strValue = '';
            while (pos < len && text[pos] !== '"') {
                if (text[pos] === '\\' && pos + 1 < len) {
                    strValue += advance(); // 反斜杠
                    strValue += advance(); // 转义字符
                } else if (text[pos] === '\n') {
                    // 多行字符串
                    strValue += advance();
                } else if (text[pos] === '$') {
                    // 字符串内的变量引用 — 作为字符串内容
                    strValue += advance();
                } else {
                    strValue += advance();
                }
            }
            if (pos < len) { advance(); } // 跳过闭引号
            tokens.push({
                type: TokenType.STRING,
                value: strValue,
                line: strLine,
                column: strCol,
                rawLength: strValue.length + 2
            });
            continue;
        }

        // 花括号字面量
        if (ch === '{') {
            const braceLine = line;
            const braceCol = col;
            advance(); // 跳过 {
            let depth = 1;
            let braceValue = '';
            while (pos < len && depth > 0) {
                const c = text[pos];
                if (c === '{') {
                    depth++;
                    braceValue += advance();
                } else if (c === '}') {
                    depth--;
                    if (depth > 0) {
                        braceValue += advance();
                    }
                } else if (c === '\\' && pos + 1 < len) {
                    braceValue += advance();
                    braceValue += advance();
                } else {
                    braceValue += advance();
                }
            }
            if (pos < len) { advance(); } // 跳过 }
            tokens.push({
                type: TokenType.BRACED,
                value: braceValue,
                line: braceLine,
                column: braceCol,
                rawLength: braceValue.length + 2
            });
            continue;
        }

        // 方括号命令替换 — 作为 BRACED 类似处理（我们不深入解析嵌套命令）
        if (ch === '[') {
            const bracketLine = line;
            const bracketCol = col;
            advance(); // 跳过 [
            let depth = 1;
            let bracketValue = '';
            while (pos < len && depth > 0) {
                const c = text[pos];
                if (c === '[') { depth++; bracketValue += advance(); }
                else if (c === ']') { depth--; if (depth > 0) { bracketValue += advance(); } }
                else if (c === '"') {
                    bracketValue += advance();
                    while (pos < len && text[pos] !== '"') {
                        if (text[pos] === '\\' && pos + 1 < len) {
                            bracketValue += advance();
                            bracketValue += advance();
                        } else { bracketValue += advance(); }
                    }
                    if (pos < len) { bracketValue += advance(); }
                }
                else if (c === '{') {
                    let bd = 1;
                    bracketValue += advance();
                    while (pos < len && bd > 0) {
                        const bc = text[pos];
                        if (bc === '{') { bd++; }
                        else if (bc === '}') { bd--; }
                        bracketValue += advance();
                    }
                }
                else { bracketValue += advance(); }
            }
            if (pos < len) { advance(); } // 跳过 ]
            tokens.push({
                type: TokenType.BRACED,
                value: `[${bracketValue}]`,
                line: bracketLine,
                column: bracketCol,
                rawLength: bracketValue.length + 2
            });
            continue;
        }

        // 变量引用
        if (ch === '$') {
            const varLine = line;
            const varCol = col;
            advance(); // 跳过 $
            if (peek() === '{') {
                advance(); // 跳过 {
                let varName = '';
                while (pos < len && text[pos] !== '}') {
                    varName += advance();
                }
                if (pos < len) { advance(); } // 跳过 }
                tokens.push({
                    type: TokenType.VARIABLE_REF,
                    value: varName,
                    line: varLine,
                    column: varCol,
                    rawLength: varName.length + 3  // ${...}
                });
            } else {
                let varName = '';
                // TCL 变量名: 字母/数字/下划线，:: 为命名空间分隔符
                // 单独的 : 不属于变量名（如 $BOTTOM_LAYER: 的 : 是字面字符）
                while (pos < len && /[a-zA-Z0-9_]/.test(text[pos])) {
                    varName += advance();
                }
                // 处理命名空间 :: 分隔符
                while (pos + 1 < len && text[pos] === ':' && text[pos + 1] === ':') {
                    varName += advance(); // 第一个 :
                    varName += advance(); // 第二个 :
                    while (pos < len && /[a-zA-Z0-9_]/.test(text[pos])) {
                        varName += advance();
                    }
                }
                tokens.push({
                    type: TokenType.VARIABLE_REF,
                    value: varName,
                    line: varLine,
                    column: varCol,
                    rawLength: varName.length + 1  // $name
                });
            }
            continue;
        }

        // 普通词（命令名或参数）
        let word = '';
        const wordLine = line;
        const wordCol = col;
        while (pos < len && !/[\s;\[\]{}\"$\\#]/.test(text[pos])) {
            word += advance();
        }
        if (word.length > 0) {
            // 判断是否为行首命令：检查上一个非空白 token 是否为 NEWLINE/SEMICOLON
            let isCommand = true;
            for (let ti = tokens.length - 1; ti >= 0; ti--) {
                const pt = tokens[ti];
                if (pt.type === TokenType.NEWLINE || pt.type === TokenType.SEMICOLON) {
                    isCommand = true;
                    break;
                }
                if (pt.type !== TokenType.COMMENT) {
                    isCommand = false;
                    break;
                }
            }
            tokens.push({
                type: isCommand ? TokenType.COMMAND : TokenType.WORD,
                value: word,
                line: wordLine,
                column: wordCol,
                rawLength: word.length
            });
        }
        // 如果 word 为空且 ch 不是空白等，直接跳过该字符（防止死循环）
        if (word.length === 0) {
            advance();
        }
    }

    tokens.push({ type: TokenType.EOF, value: '', line, column: col, rawLength: 0 });
    return tokens;
}

// ════════════════════════════════════════════════════════════
//  Parser
// ════════════════════════════════════════════════════════════

/**
 * 解析 token 流为 AST 节点列表。
 * 识别: set, source, proc 等关键命令，以及所有变量引用。
 */
export function parse(filePath: string, text: string): ParseResult {
    const tokens = tokenize(text);
    const nodes: AstNode[] = [];
    const errors: ParseError[] = [];

    // 分类收集
    const sets: SetNode[] = [];
    const varRefs: VarRefNode[] = [];
    const sources: SourceNode[] = [];
    const procs: ProcNode[] = [];
    const commands: CommandNode[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // 跳过换行、分号、注释、EOF
        if (token.type === TokenType.NEWLINE ||
            token.type === TokenType.SEMICOLON ||
            token.type === TokenType.COMMENT ||
            token.type === TokenType.EOF) {
            // 检查是否为变量引用（token 流中的独立 $var）
            // 实际上变量引用已经由 tokenizer 处理为 VARIABLE_REF
            continue;
        }

        // 变量引用（独立出现在 token 流中，例如 expr {...} 或嵌套情况）
        if (token.type === TokenType.VARIABLE_REF) {
            const ref: VarRefNode = {
                kind: 'var_ref',
                varName: token.value,
                isBraceForm: false,
                line: token.line,
                column: token.column,
                rawText: token.value
            };
            nodes.push(ref);
            varRefs.push(ref);
            continue;
        }

        // 处理命令（COMMAND 类型的 token）
        if (token.type === TokenType.COMMAND) {
            const cmdName = token.value;
            const cmdLine = token.line;
            const cmdCol = token.column;

            // 收集此命令的所有参数 tokens
            const argTokens: Token[] = [];
            let lastIdx = i;
            for (let j = i + 1; j < tokens.length; j++) {
                const nt = tokens[j];
                if (nt.type === TokenType.NEWLINE ||
                    nt.type === TokenType.SEMICOLON ||
                    nt.type === TokenType.EOF) {
                    lastIdx = j;
                    break;
                }
                if (nt.type === TokenType.COMMENT) {
                    lastIdx = j;
                    break;
                }
                argTokens.push(nt);
                lastIdx = j;
            }

            // 构建原始文本
            const rawParts: string[] = [cmdName];
            for (const a of argTokens) {
                if (a.type === TokenType.STRING) { rawParts.push(`"${a.value}"`); }
                else if (a.type === TokenType.BRACED) { rawParts.push(a.value); }
                else { rawParts.push(a.value); }
            }
            const rawText = rawParts.join(' ');

            // ---- 处理 set 命令 ----
            if (cmdName === 'set' && argTokens.length >= 2) {
                const varToken = argTokens[0];
                const varName = varToken.value;
                // 值 tokens 从 index 1 开始
                const valueTokens = argTokens.slice(1);

                // 检查值 tokens 中是否有变量引用
                for (const vt of valueTokens) {
                    if (vt.type === TokenType.VARIABLE_REF) {
                        const ref: VarRefNode = {
                            kind: 'var_ref',
                            varName: vt.value,
                            isBraceForm: false,
                            line: vt.line,
                            column: vt.column,
                            rawText: vt.value
                        };
                        nodes.push(ref);
                        varRefs.push(ref);
                    }
                    // 也检查 STRING 和 BRACED 中的 $ 符号
                    if (vt.type === TokenType.STRING || vt.type === TokenType.BRACED) {
                        extractVarRefsFromText(vt.value, vt.line, vt.column)
                            .forEach(r => {
                                nodes.push(r);
                                varRefs.push(r);
                            });
                    }
                }

                // 构建值文本（用于简单值解析）
                const valueText = valueTokens.map(t => {
                    if (t.type === TokenType.STRING) { return `"${t.value}"`; }
                    if (t.type === TokenType.BRACED) { return t.value; }
                    return t.value;
                }).join(' ');

                const setNode: SetNode = {
                    kind: 'set',
                    varName,
                    valueTokens,
                    valueText,
                    line: cmdLine,
                    column: cmdCol,
                    rawText
                };
                nodes.push(setNode);
                sets.push(setNode);
            }
            // ---- 处理 source 命令 ----
            else if (cmdName === 'source' && argTokens.length >= 1) {
                // 拼接所有参数 token 形成完整路径（支持 $var/path/subpath 拼接）
                let filePath = '';
                for (const at of argTokens) {
                    if (at.type === TokenType.VARIABLE_REF) {
                        filePath += '$' + at.value;
                    } else if (at.type === TokenType.STRING) {
                        filePath += at.value; // 双引号字符串，value 不含引号
                    } else if (at.type === TokenType.BRACED) {
                        filePath += at.value; // 花括号内容
                    } else {
                        filePath += at.value;
                    }
                }
                // 去掉首尾空白
                filePath = filePath.trim();
                const sourceNode: SourceNode = {
                    kind: 'source',
                    filePath,
                    line: cmdLine,
                    column: cmdCol,
                    rawText
                };
                nodes.push(sourceNode);
                sources.push(sourceNode);
            }
            // ---- 处理 proc 命令 ----
            else if (cmdName === 'proc' && argTokens.length >= 3) {
                const procToken = argTokens[0];
                const procName = procToken.value;
                // args 在花括号中 — 使用 TCL 列表解析（支持 {arg default} 默认值语法）
                const argsToken = argTokens[1];
                let argsStr = '';
                if (argsToken.type === TokenType.BRACED) {
                    argsStr = argsToken.value;
                } else {
                    argsStr = argsToken.value;
                }
                const args = parseProcArgs(argsStr);

                // 提取 body 文本（argTokens[2..] 合并）
                const bodyStartLine = argTokens[2].line;
                const bodyEndLine = getTokenEndLine(argTokens[argTokens.length - 1], tokens);
                const bodyTextParts: string[] = [];
                for (let k = 2; k < argTokens.length; k++) {
                    bodyTextParts.push(argTokens[k].value);
                }
                const bodyText = bodyTextParts.join('');

                const procNode: ProcNode = {
                    kind: 'proc',
                    procName,
                    args,
                    bodyStartLine,
                    bodyEndLine,
                    bodyText,
                    line: cmdLine,
                    column: cmdCol,
                    rawText
                };
                nodes.push(procNode);
                procs.push(procNode);

                // proc body 中的变量引用也需要提取
                for (let k = 2; k < argTokens.length; k++) {
                    const at = argTokens[k];
                    if (at.type === TokenType.BRACED || at.type === TokenType.STRING) {
                        extractVarRefsFromText(at.value, at.line, at.column)
                            .forEach(r => {
                                nodes.push(r);
                                varRefs.push(r);
                            });
                    }
                }
            }
            // ---- 通用命令 ----
            else {
                const cmdNode: CommandNode = {
                    kind: 'command',
                    commandName: cmdName,
                    args: argTokens,
                    line: cmdLine,
                    column: cmdCol,
                    rawText
                };
                nodes.push(cmdNode);
                commands.push(cmdNode);

                // 提取命令参数中的变量引用
                for (const at of argTokens) {
                    if (at.type === TokenType.VARIABLE_REF) {
                        const ref: VarRefNode = {
                            kind: 'var_ref',
                            varName: at.value,
                            isBraceForm: false,
                            line: at.line,
                            column: at.column,
                            rawText: at.value
                        };
                        nodes.push(ref);
                        varRefs.push(ref);
                    }
                    if (at.type === TokenType.STRING || at.type === TokenType.BRACED) {
                        extractVarRefsFromText(at.value, at.line, at.column)
                            .forEach(r => {
                                nodes.push(r);
                                varRefs.push(r);
                            });
                    }
                }
            }

            // 跳到此命令的最后一个 token
            i = lastIdx;
            continue;
        }

        // 其他 token 类型（WORD 等不在命令开头的），跳过
    }

    return {
        filePath,
        nodes,
        sets,
        varRefs,
        sources,
        procs,
        commands,
        errors
    };
}

/**
 * 从文本中提取 $varName 和 ${varName} 变量引用。
 * 用于 STRING 和 BRACED token 内部的变量引用提取。
 * 支持多行文本，自动计算每个引用的实际行号和列号。
 * 自动跳过 TCL 注释行（# 开头）和行内注释（;# 之后）中的变量引用。
 */
function extractVarRefsFromText(text: string, baseLine: number, baseCol: number): VarRefNode[] {
    const refs: VarRefNode[] = [];

    // 匹配 $varName (不包含 ${varName})
    // 命名空间 :: 分隔符有效，单独 : 不属于变量名
    const regex = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z0-9_]*)*)\}?/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        const isBraceForm = match[1] === '{';
        const varName = match[2];

        // 计算 match.index 之前的文本，确定实际行号和列号
        const textBefore = text.substring(0, match.index);
        const linesBefore = textBefore.split('\n');
        const newlineCount = linesBefore.length - 1;
        const line = baseLine + newlineCount;

        // ── 跳过注释中的 $var 引用 ──
        // 获取当前行中 match 之前的文本（从最后一个换行符之后到 match 位置）
        const currentLineText = newlineCount > 0
            ? linesBefore[linesBefore.length - 1]
            : textBefore;
        // 如果该行去掉前导空白后以 # 开头，或是 ;# 之后的文本，则跳过
        const trimmedLine = currentLineText.trimStart();
        if (trimmedLine.startsWith('#')) {
            continue;  // 整行注释
        }
        // 检查 ;# 行内注释：match 出现在 ;# 之后
        const inlineCommentIdx = currentLineText.indexOf(';#');
        if (inlineCommentIdx >= 0 && match.index > textBefore.lastIndexOf('\n') + inlineCommentIdx) {
            continue;  // 行内注释之后
        }

        // 列号：最后一个换行符之后的位置
        // baseCol 指向外层 token 的起始位置（如 { 或 "）
        // text 是 token 内部文本（不含外层定界符）
        const col = newlineCount > 0
            ? linesBefore[linesBefore.length - 1].length + 1  // 1-based column on new line
            : baseCol + match.index + 1;  // 同一行：baseCol + 1(跳过定界符) + match.index

        refs.push({
            kind: 'var_ref',
            varName,
            isBraceForm,
            line,
            column: col,
            rawText: match[0]
        });
    }
    return refs;
}

/** 获取 token 的结束行号 */
function getTokenEndLine(token: Token, allTokens: Token[]): number {
    // 简化处理：返回 token 的行号
    // 对于跨行 token（多行字符串或花括号块），需要更复杂的计算
    return token.line;
}

// ════════════════════════════════════════════════════════════
//  Proc 参数解析
// ════════════════════════════════════════════════════════════

/**
 * 解析 proc 参数列表，正确支持 TCL 默认值语法 {argName defaultValue}。
 *
 * TCL proc 参数格式:
 *   proc name {arg1 arg2 {arg3 defaultVal}} {body}
 *
 * 其中 {arg3 defaultVal} 是一个 TCL 列表元素，表示 arg3 有默认值。
 * 简单 split 会错误地将 "{arg3" 和 "defaultVal}" 拆分为两个参数。
 *
 * @param argsStr - 参数花括号内的原始文本（不含外层花括号）
 * @returns 参数名列表（仅参数名，不含默认值）
 */
export function parseProcArgs(argsStr: string): string[] {
    const argNames: string[] = [];
    let i = 0;
    const len = argsStr.length;

    while (i < len) {
        // 跳过空白
        while (i < len && /\s/.test(argsStr[i])) { i++; }
        if (i >= len) { break; }

        if (argsStr[i] === '{') {
            // 花括号元素: {argName defaultValue} — 作为一个原子元素
            let depth = 1;
            let element = '';
            i++; // 跳过开 {
            while (i < len && depth > 0) {
                if (argsStr[i] === '{') { depth++; element += argsStr[i]; }
                else if (argsStr[i] === '}') {
                    depth--;
                    if (depth > 0) { element += argsStr[i]; }
                } else {
                    element += argsStr[i];
                }
                i++;
            }
            // element 现在是 "{argName defaultValue}" 花括号内的文本
            // 提取第一个词作为参数名
            const firstWord = element.trim().split(/\s+/)[0];
            if (firstWord) { argNames.push(firstWord); }
        } else {
            // 普通词
            let word = '';
            while (i < len && !/\s/.test(argsStr[i])) {
                word += argsStr[i];
                i++;
            }
            if (word.length > 0) { argNames.push(word); }
        }
    }

    return argNames;
}

// ════════════════════════════════════════════════════════════
//  工具函数
// ════════════════════════════════════════════════════════════

/**
 * 将 TCL 值文本解析为简单值。
 * 处理: 引号去除、花括号去除、简单变量值。
 */
export function resolveSimpleValue(valueText: string): string {
    let val = valueText.trim();

    // 去除双引号
    if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
    }
    // 去除花括号
    if (val.startsWith('{') && val.endsWith('}')) {
        val = val.slice(1, -1);
    }

    return val;
}

/**
 * 检测值文本中是否包含变量引用（未解析的 $）。
 */
export function containsVarRef(valueText: string): boolean {
    // 检查是否有 $ 但不是 TCL 命令替换 $
    return /\$[a-zA-Z_{]/.test(valueText);
}
