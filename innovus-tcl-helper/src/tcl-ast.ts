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
    args: string[];            // 参数名列表
    bodyStartLine: number;     // body 开始行
    bodyEndLine: number;       // body 结束行
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

        // 注释（仅在行首或空白后有效）
        if (ch === '#') {
            // 如果上一个 token 是 NEWLINE 或 SEMICOLON 或这是第一个 token
            const isFirstToken = tokens.length === 0;
            const prevNonNewline = findLastSignificantToken(tokens);
            if (isFirstToken || !prevNonNewline ||
                prevNonNewline.type === TokenType.NEWLINE ||
                prevNonNewline.type === TokenType.SEMICOLON ||
                (prevNonNewline.type !== TokenType.WORD &&
                    prevNonNewline.type !== TokenType.COMMAND &&
                    prevNonNewline.type !== TokenType.STRING &&
                    prevNonNewline.type !== TokenType.BRACED)) {
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
                while (pos < len && /[a-zA-Z0-9_:]/.test(text[pos])) {
                    varName += advance();
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
            // 判断是否为行首命令（前一个 token 是 NEWLINE/SEMICOLON 或第一个）
            const prev = findLastSignificantToken(tokens);
            const isCommand = !prev ||
                prev.type === TokenType.NEWLINE ||
                prev.type === TokenType.SEMICOLON;
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

/** 找到最后一个有意义的 token（跳过 NEWLINE 和 SEMICOLON） */
function findLastSignificantToken(tokens: Token[]): Token | null {
    for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i];
        if (t.type !== TokenType.NEWLINE && t.type !== TokenType.SEMICOLON) {
            return t;
        }
    }
    return null;
}

/** 找到上一个有意义的 token（跳过 NEWLINE, SEMICOLON, COMMENT） */
function findPrevToken(tokens: Token[], idx: number): Token | null {
    for (let i = idx - 1; i >= 0; i--) {
        const t = tokens[i];
        if (t.type !== TokenType.NEWLINE && t.type !== TokenType.SEMICOLON &&
            t.type !== TokenType.COMMENT) {
            return t;
        }
    }
    return null;
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
                const fileToken = argTokens[0];
                let filePath = fileToken.value;
                // 去掉可能的引号或花括号
                filePath = filePath.replace(/^["']/, '').replace(/["']$/, '');
                filePath = filePath.replace(/^\{/, '').replace(/\}$/, '');
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
                // args 在花括号中
                const argsToken = argTokens[1];
                let argsStr = '';
                if (argsToken.type === TokenType.BRACED) {
                    argsStr = argsToken.value;
                } else {
                    argsStr = argsToken.value;
                }
                const args = argsStr.trim().split(/\s+/).filter(a => a.length > 0);

                const procNode: ProcNode = {
                    kind: 'proc',
                    procName,
                    args,
                    bodyStartLine: argTokens.length >= 3 ? argTokens[2].line : cmdLine,
                    bodyEndLine: argTokens.length >= 3
                        ? getTokenEndLine(argTokens[argTokens.length - 1], tokens)
                        : cmdLine,
                    line: cmdLine,
                    column: cmdCol,
                    rawText
                };
                nodes.push(procNode);
                procs.push(procNode);

                // proc body 中的变量引用也需要提取
                if (argTokens.length >= 3) {
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
 */
function extractVarRefsFromText(text: string, baseLine: number, baseCol: number): VarRefNode[] {
    const refs: VarRefNode[] = [];
    // 注意：TCL 中花括号内不做变量替换，所以跳过 BRACED 类型
    // 此函数主要用于 STRING 类型 token 内部

    // 匹配 $varName (不包含 ${varName})
    const regex = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_:]*)\}?/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        const isBraceForm = match[1] === '{';
        const varName = match[2];
        refs.push({
            kind: 'var_ref',
            varName,
            isBraceForm,
            line: baseLine,
            column: baseCol + match.index,
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
