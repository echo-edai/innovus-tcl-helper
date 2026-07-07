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
                        version: '0.3.0'
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
                    }););
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

logToStderr(`Starting Innovus TCL MCP Server v0.3.0`);
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
