#!/usr/bin/env node
/**
 * Innovus TCL MCP Server
 *
 * Model Context Protocol server for Cadence Innovus TCL commands.
 * Provides tools for Copilot to query Innovus command documentation
 * and lint TCL scripts.
 *
 * Usage:
 *   node scripts/mcp-server.mjs [--data-root <path>] [--lang zh|en]
 *
 * Configure in VS Code .vscode/mcp.json:
 *   {
 *     "servers": {
 *       "innovus-tcl": {
 *         "type": "stdio",
 *         "command": "node",
 *         "args": ["${workspaceFolder}/.vscode/extensions/.../scripts/mcp-server.mjs",
 *                  "--data-root", "/path/to/data_base"]
 *       }
 *     }
 *   }
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ════════════════════════════════════════════════════════════
//  Configuration
// ════════════════════════════════════════════════════════════

let DATA_ROOT = '';
let LANGUAGE = 'zh';

for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--data-root' && i + 1 < process.argv.length) {
        DATA_ROOT = process.argv[++i];
    } else if (process.argv[i] === '--lang' && i + 1 < process.argv.length) {
        LANGUAGE = process.argv[++i];
    }
}

// Auto-detect data root
if (!DATA_ROOT) {
    // Try relative to script location: ../../data/
    const candidates = [
        path.join(__dirname, '..', 'data'),
        path.join(__dirname, '..', '..', 'data_base'),
        path.join(process.cwd(), 'data'),
        path.join(process.cwd(), 'data_base'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            DATA_ROOT = c;
            break;
        }
    }
}

function getHelpDir() {
    // 结构: data/cmds/innovus/{version}/{langDir}/help/
    const version = '25.1';
    const langDir = LANGUAGE === 'zh' ? 'cn' : 'en';
    return path.join(DATA_ROOT, 'cmds', 'innovus', version, langDir, 'help');
}

// ════════════════════════════════════════════════════════════
//  Command Database
// ════════════════════════════════════════════════════════════

/** @type {Map<string, object>} */
const commandDB = new Map();
let dbLoaded = false;

function loadDB() {
    if (dbLoaded) return;
    const helpDir = getHelpDir();
    if (!fs.existsSync(helpDir)) {
        logToStderr(`[MCP] Help directory not found: ${helpDir}`);
        return;
    }

    const files = fs.readdirSync(helpDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(helpDir, file), 'utf-8');
            const info = JSON.parse(content);
            if (info.command) {
                commandDB.set(info.command, info);
            }
        } catch { /* skip */ }
    }
    dbLoaded = true;
    logToStderr(`[MCP] Loaded ${commandDB.size} Innovus commands`);
}

function getCommand(name) {
    loadDB();
    return commandDB.get(name) || null;
}

function getAllCommandNames() {
    loadDB();
    return Array.from(commandDB.keys());
}

// ════════════════════════════════════════════════════════════
//  TCL Script Parser
// ════════════════════════════════════════════════════════════

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

/** Extract -flag params from a TCL line */
function extractParams(line) {
    const params = {};
    const tokens = line.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith('-')) {
            const flag = t.replace(/[,;]$/, '');
            if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
                let val = tokens[i + 1].replace(/[,;]$/, '');
                val = val.replace(/^\{/, '').replace(/\}$/, '');
                params[flag] = val;
                i++;
            } else {
                params[flag] = null;
            }
        }
    }
    return params;
}

// ════════════════════════════════════════════════════════════
//  Tool: innovus_parse_tcl_script
// ════════════════════════════════════════════════════════════

function toolParseScript({ script_content }) {
    loadDB();
    const isZh = LANGUAGE === 'zh';
    if (!script_content || typeof script_content !== 'string') {
        return { error: isZh ? '请提供 script_content' : 'Please provide script_content' };
    }

    const lines = script_content.split('\n');

    /** @type {Map<string, {lineNumber: number, lineText: string, params: object}[]>} */
    const commandCalls = new Map();
    /** @type {Map<string, string[]>} */
    const modeVariables = new Map();
    const unknownTokens = new Map();
    let commentLines = 0, blankLines = 0;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) { blankLines++; continue; }
        if (trimmed.startsWith('#')) { commentLines++; continue; }

        const firstToken = trimmed.split(/\s/)[0];
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(firstToken)) continue;
        if (TCL_BUILTINS.has(firstToken)) continue;

        const cmdInfo = getCommand(firstToken);
        if (cmdInfo && cmdInfo.is_cmd !== false) {
            const params = extractParams(trimmed);
            const call = { lineNumber: i + 1, lineText: trimmed, params };
            const existing = commandCalls.get(firstToken);
            if (existing) existing.push(call);
            else commandCalls.set(firstToken, [call]);
        } else if (cmdInfo) {
            const uses = modeVariables.get(firstToken) || [];
            uses.push(trimmed);
            modeVariables.set(firstToken, uses);
        } else {
            unknownTokens.set(firstToken, (unknownTokens.get(firstToken) || 0) + 1);
        }
    }

    // Build result
    const result = {
        summary: {
            totalLines: lines.length,
            codeLines: lines.length - commentLines - blankLines,
            commentLines,
            blankLines,
            innovusCommandTypes: commandCalls.size,
            totalCommandCalls: Array.from(commandCalls.values()).reduce((s, v) => s + v.length, 0),
            modeVariableCount: modeVariables.size,
            unrecognizedTokenCount: unknownTokens.size,
        },
        scriptContent: script_content,
        commands: []
    };

    for (const [cmdName, calls] of commandCalls) {
        const cmdInfo = getCommand(cmdName);
        if (!cmdInfo) continue;

        const cmdEntry = {
            command: cmdName,
            summary: cmdInfo.summary || '',
            description: cmdInfo.description || '',
            usage: cmdInfo.usage || '',
            options: cmdInfo.options || [],
            callCount: calls.length,
            calls: calls.map(c => ({
                line: c.lineNumber,
                text: c.lineText,
                params: c.params,
                // Parameter comparison
                paramStatus: (cmdInfo.options || []).map(opt => ({
                    option: opt.name,
                    type: opt.type,
                    required: opt.required,
                    description: opt.description || '',
                    used: opt.name in c.params,
                    value: c.params[opt.name] ?? null,
                    status: (opt.name in c.params) ? 'used'
                        : opt.required ? 'missing_required' : 'not_used_optional'
                }))
            }))
        };
        result.commands.push(cmdEntry);
    }

    if (modeVariables.size > 0) {
        result.modeVariables = [];
        for (const [name, uses] of modeVariables) {
            const info = getCommand(name);
            result.modeVariables.push({
                name,
                summary: info?.summary || '',
                usageCount: uses.length,
                lines: uses
            });
        }
    }

    if (unknownTokens.size > 0) {
        result.unrecognized = Array.from(unknownTokens.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count }));
    }

    return result;
}

// ════════════════════════════════════════════════════════════
//  Tool: innovus_lint_tcl_script — 跨文件 Lint 检查
// ════════════════════════════════════════════════════════════

function toolLintScript({ scripts }) {
    const isZh = LANGUAGE === 'zh';
    if (!scripts || !Array.isArray(scripts) || scripts.length === 0) {
        return { error: isZh ? '请提供 scripts 数组（至少一个脚本）' : 'Please provide scripts array (at least one script)' };
    }

    const errors = [];
    const warnings = [];
    const infoMessages = [];
    const variables = {}; // varName → { value, file, line, order }
    const varRefs = [];   // { name, file, line, defined }

    // Process each script in order
    for (let order = 0; order < scripts.length; order++) {
        const { file, content } = scripts[order];
        if (!content || typeof content !== 'string') { continue; }

        const fileName = file || `script_${order + 1}.tcl`;
        const lines = content.split('\n');

        // Check brackets and quotes per script
        checkBracketsScript(lines, fileName, errors);
        checkQuotesScript(lines, fileName, errors);

        // Extract set and variable references per line
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const trimmed = line.trim();
            const lineNum = lineIdx + 1;

            if (!trimmed || trimmed.startsWith('#')) { continue; }

            // Check for set command: set varName value
            const setMatch = trimmed.match(/^set\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/);
            if (setMatch) {
                const varName = setMatch[1];
                const rawValue = setMatch[2].trim();

                // Simple value extraction (remove quotes/braces)
                let value = rawValue;
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                }
                if (value.startsWith('{') && value.endsWith('}')) {
                    value = value.slice(1, -1);
                }

                // Check if value references other variables
                const refsInValue = extractVarRefs(value);
                let isResolved = refsInValue.length === 0;

                // Update variable table
                if (!variables[varName]) {
                    variables[varName] = [];
                }
                variables[varName].push({
                    value,
                    rawValue,
                    file: fileName,
                    line: lineNum,
                    order,
                    isResolved
                });

                // Check for references to undefined variables
                for (const refName of refsInValue) {
                    if (!variables[refName] || variables[refName].length === 0) {
                        errors.push({
                            message: isZh
                                ? `变量 "${refName}" 未定义（在 "${varName}" 的值中引用）`
                                : `Variable "${refName}" is undefined (referenced in value of "${varName}")`,
                            file: fileName,
                            line: lineNum
                        });
                    }
                }
                continue;
            }

            // Check for variable references: $varName and ${varName}
            const refsInLine = extractVarRefs(trimmed);
            for (const refName of refsInLine) {
                const definitions = variables[refName];
                const isDefined = definitions && definitions.length > 0;

                if (isDefined) {
                    // Check if defined before this reference
                    const latestDef = definitions[definitions.length - 1];
                    if (latestDef.order > order || (latestDef.order === order && latestDef.line >= lineNum)) {
                        warnings.push({
                            message: isZh
                                ? `变量 "${refName}" 在定义之前使用（定义在 ${latestDef.file}:${latestDef.line}）`
                                : `Variable "${refName}" used before definition (defined at ${latestDef.file}:${latestDef.line})`,
                            file: fileName,
                            line: lineNum
                        });
                    }
                } else {
                    errors.push({
                        message: isZh
                            ? `未定义的变量 "${refName}"`
                            : `Undefined variable "${refName}"`,
                        file: fileName,
                        line: lineNum
                    });
                }

                varRefs.push({
                    name: refName,
                    file: fileName,
                    line: lineNum,
                    defined: isDefined
                });
            }
        }
    }

    // Check for unused variables
    const usedVarNames = new Set(varRefs.map(r => r.name));
    for (const varName of Object.keys(variables)) {
        if (!usedVarNames.has(varName)) {
            const defs = variables[varName];
            const lastDef = defs[defs.length - 1];
            warnings.push({
                message: isZh
                    ? `变量 "${varName}" 已定义但从未使用`
                    : `Variable "${varName}" is defined but never used`,
                file: lastDef.file,
                line: lastDef.line
            });
        }
    }

    return {
        summary: {
            scriptCount: scripts.length,
            variableDefCount: Object.values(variables).reduce((s, arr) => s + arr.length, 0),
            variableRefCount: varRefs.length,
            uniqueVariables: Object.keys(variables).length,
            errorCount: errors.length,
            warningCount: warnings.length,
            infoCount: infoMessages.length
        },
        variables,
        errors,
        warnings,
        info: infoMessages
    };
}

/** Check brackets in a single script */
function checkBracketsScript(lines, fileName, errors) {
    let bracketDepth = 0;
    let braceDepth = 0;
    let inString = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('#')) { continue; }

        for (let j = 0; j < line.length; j++) {
            const ch = line[j];
            const prevCh = j > 0 ? line[j - 1] : '';

            if (ch === '\\' && j + 1 < line.length) { j++; continue; }
            if (ch === '"' && prevCh !== '\\') { inString = !inString; continue; }
            if (inString) { continue; }

            if (ch === '[') { bracketDepth++; }
            if (ch === ']') { bracketDepth--; }
            if (ch === '{') { braceDepth++; }
            if (ch === '}') { braceDepth--; }

            if (bracketDepth < 0) {
                errors.push({
                    message: `多余的右方括号 "]"`,
                    file: fileName,
                    line: i + 1
                });
                bracketDepth = 0;
            }
            if (braceDepth < 0) {
                errors.push({
                    message: `多余的右花括号 "}"`,
                    file: fileName,
                    line: i + 1
                });
                braceDepth = 0;
            }
        }
    }

    if (bracketDepth > 0) {
        errors.push({
            message: `缺少 ${bracketDepth} 个右方括号 "]"`,
            file: fileName,
            line: lines.length
        });
    }
    if (braceDepth > 0) {
        errors.push({
            message: `缺少 ${braceDepth} 个右花括号 "}"`,
            file: fileName,
            line: lines.length
        });
    }
}

/** Check quotes in a single script */
function checkQuotesScript(lines, fileName, errors) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('#')) { continue; }

        let inString = false;
        for (let j = 0; j < line.length; j++) {
            const ch = line[j];
            if (ch === '\\' && j + 1 < line.length) { j++; continue; }
            if (ch === '"') { inString = !inString; }
        }
        if (inString) {
            errors.push({
                message: `未闭合的双引号`,
                file: fileName,
                line: i + 1
            });
        }
    }
}

/** Extract variable names from $varName and ${varName} references */
function extractVarRefs(text) {
    const refs = [];
    const regex = /\$(\{?)([a-zA-Z_][a-zA-Z0-9_:]*)\}?/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        refs.push(match[2]);
    }
    return [...new Set(refs)];
}

// ════════════════════════════════════════════════════════════
//  JSON-RPC 2.0 over stdio
// ════════════════════════════════════════════════════════════

function logToStderr(msg) {
    process.stderr.write(`[innovus-mcp] ${msg}\n`);
}

function sendResponse(id, result) {
    const response = JSON.stringify({ jsonrpc: '2.0', id, result });
    process.stdout.write(response + '\n');
}

function sendError(id, code, message) {
    const response = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
    process.stdout.write(response + '\n');
}

async function handleRequest(msg) {
    const { id, method, params } = msg;

    try {
        switch (method) {
            case 'initialize':
                sendResponse(id, {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: {
                        name: 'innovus-tcl-mcp',
                        version: '0.4.0'
                    }
                });
                break;

            case 'notifications/initialized':
                // No response needed for notifications
                break;

            case 'tools/list':
                sendResponse(id, {
                    tools: [
                        {
                            name: 'innovus_parse_tcl_script',
                            description: LANGUAGE === 'zh'
                                ? '解析 Cadence Innovus TCL 脚本。返回脚本中所有 Innovus 命令的完整文档（功能、语法、参数表），以及每个命令调用行的参数使用对照（哪些参数已使用、哪些必需参数缺失、参数值与文档类型是否匹配）。AI 应基于返回的文档事实分析脚本，不要猜测命令参数。'
                                : 'Parse a Cadence Innovus TCL script. Returns complete documentation (function, syntax, parameter table) for all Innovus commands used in the script, plus per-line parameter comparison (which params are used, which required params are missing, value-to-type matching). AI should analyze scripts based on returned doc facts, never guess parameters.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    script_content: {
                                        type: 'string',
                                        description: LANGUAGE === 'zh'
                                            ? 'TCL 脚本的完整文本内容'
                                            : 'Full text content of the TCL script'
                                    }
                                },
                                required: ['script_content']
                            }
                        },
                        {
                            name: 'innovus_lint_tcl_script',
                            description: LANGUAGE === 'zh'
                                ? '对 TCL 脚本进行静态 Lint 检查。检测括号/引号匹配、未定义变量、变量使用顺序等问题。支持传入多个脚本内容（模拟 .f 文件编译顺序）进行跨文件变量追踪。'
                                : 'Static lint checking for TCL scripts. Detects bracket/quote matching, undefined variables, variable usage order. Supports multiple scripts (simulating .f file compilation order) for cross-file variable tracking.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    scripts: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                file: { type: 'string', description: LANGUAGE === 'zh' ? '文件名（用于报告）' : 'File name (for reporting)' },
                                                content: { type: 'string', description: LANGUAGE === 'zh' ? 'TCL 脚本完整文本' : 'Full TCL script content' }
                                            },
                                            required: ['file', 'content']
                                        },
                                        description: LANGUAGE === 'zh'
                                            ? 'TCL 脚本列表（按 .f 文件编译顺序排列），每个元素包含 file（文件名）和 content（脚本内容）。第一个脚本中定义的变量在后续脚本中可见。'
                                            : 'List of TCL scripts (in .f file compilation order), each with file name and content. Variables defined in earlier scripts are visible in later scripts.'
                                    }
                                },
                                required: ['scripts']
                            }
                        }
                    ]
                });
                break;

            case 'tools/call':
                const toolName = params?.name;
                const toolArgs = params?.arguments || {};

                if (toolName === 'innovus_parse_tcl_script') {
                    const result = toolParseScript(toolArgs);
                    sendResponse(id, {
                        content: [
                            { type: 'text', text: JSON.stringify(result, null, 2) }
                        ]
                    });
                } else if (toolName === 'innovus_lint_tcl_script') {
                    const result = toolLintScript(toolArgs);
                    sendResponse(id, {
                        content: [
                            { type: 'text', text: JSON.stringify(result, null, 2) }
                        ]
                    });
                } else {
                    sendError(id, -32601, `Unknown tool: ${toolName}`);
                }
                break;

            default:
                sendError(id, -32601, `Unknown method: ${method}`);
        }
    } catch (err) {
        logToStderr(`Error handling ${method}: ${err.message}`);
        sendError(id, -32603, err.message);
    }
}

// ════════════════════════════════════════════════════════════
//  Main
// ════════════════════════════════════════════════════════════

logToStderr(`Starting Innovus TCL MCP Server v0.4.0`);
logToStderr(`Data root: ${DATA_ROOT}`);
logToStderr(`Language: ${LANGUAGE}`);

// Preload DB
loadDB();

const rl = createInterface({ input: process.stdin, terminal: false });
let buffer = '';

rl.on('line', (line) => {
    buffer += line;
    try {
        const msg = JSON.parse(buffer);
        buffer = '';
        handleRequest(msg);
    } catch {
        // Incomplete JSON, wait for more lines
    }
});

rl.on('close', () => {
    logToStderr('MCP Server shutting down');
});

// Keep process alive
process.stdin.resume();
