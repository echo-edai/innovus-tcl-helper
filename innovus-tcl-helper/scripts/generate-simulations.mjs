#!/usr/bin/env node
/**
 * Innovus 命令仿真数据生成器 — DeepSeek Flash API
 *
 * 功能:
 *   - 遍历命令 help JSON，调用 AI 生成 TCL proc 仿真包装器
 *   - 支持 cn/en 双语生成
 *   - 并发控制 + 限流重试 + 断点续传
 *   - 主日志 + 按 worker 分日志（最大 500 行滚动）
 *   - 增量生成：已有仿真数据自动跳过
 *
 * 用法:
 *   node scripts/generate-simulations.mjs [--lang cn|en] [--limit N] [--concurrency N] [--dry-run]
 *   默认并发 30（deepseek-v4-flash 上限 2500）
 *
 * 环境变量:
 *   DEEPSEEK_API_KEY
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ════════════════════════════════════════════════════════════
//  配置
// ════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const LANGS = args.includes('--lang') ? [args[args.indexOf('--lang') + 1]] : ['cn', 'en'];
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;
const DRY_RUN = args.includes('--dry-run');
const TARGET_CMDS = args.includes('--cmds')
    ? new Set(args[args.indexOf('--cmds') + 1].split(',').map(s => s.trim()))
    : null;

const API = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-v4-flash';
const CONCURRENCY = args.includes('--concurrency')
    ? parseInt(args[args.indexOf('--concurrency') + 1])
    : 30;  // deepseek-v4-flash 并发上限 2500，30 安全快速
const RETRY_DELAY = 2000;
const MAX_RETRIES = 3;
const MAX_LOG_LINES = 500;

// ════════════════════════════════════════════════════════════
//  日志系统
// ════════════════════════════════════════════════════════════

const LOG_DIR = path.join(ROOT, 'data', 'simulations', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

class Logger {
    constructor(filePath) {
        this.filePath = filePath;
        this.buffer = [];
        this.count = 0;
    }
    log(msg) {
        const line = `[${new Date().toISOString().substring(11, 19)}] ${msg}`;
        this.buffer.push(line);
        this.count++;
        if (this.buffer.length >= 20) { this.flush(); }
    }
    flush() {
        if (this.buffer.length === 0) return;
        let content = fs.existsSync(this.filePath)
            ? fs.readFileSync(this.filePath, 'utf-8') : '';
        let lines = content.split('\n').filter(l => l.trim());
        lines.push(...this.buffer);
        // 滚动：保持最近 MAX_LOG_LINES 行
        if (lines.length > MAX_LOG_LINES) {
            lines = lines.slice(lines.length - MAX_LOG_LINES);
        }
        fs.writeFileSync(this.filePath, lines.join('\n') + '\n', 'utf-8');
        this.buffer = [];
    }
}

const mainLog = new Logger(path.join(LOG_DIR, 'generation.log'));
const workerLogs = [];
for (let i = 0; i < CONCURRENCY; i++) {
    workerLogs.push(new Logger(path.join(LOG_DIR, `worker-${i}.log`)));
}

// ════════════════════════════════════════════════════════════
//  Prompt 模板
// ════════════════════════════════════════════════════════════

function buildPrompt(cmdInfo, lang) {
    const { command, summary, description, usage, options, is_cmd } = cmdInfo;
    const isVariable = (is_cmd === false);

    if (isVariable) {
        if (lang === 'cn') {
            return {
                system: '你是 Innovus EDA 仿真专家。只输出 TCL proc 代码，不输出解释。',
                user: `为 Innovus 配置变量 "${command}" 生成 TCL proc。\n\n变量说明: ${summary}。${description || ''}\n设置方式: set ${command} <value>\n\n要求: 读取第一个参数作为值，puts 中文描述；无参数则只描述功能。只输出 TCL 代码。`
            };
        }
        return {
            system: 'You are an Innovus EDA simulation expert. Output only TCL proc code.',
            user: `Generate TCL proc for Innovus global variable "${command}".

Variable description: ${summary}. ${description || ''}
Usage: set ${command} <value>

Requirements:
1. Parse first positional arg as the value; if no args, just describe the variable
2. puts a short English description of what this variable controls and what value was set
3. proc signature: proc ${command} {args} { ... }
4. Return "", output TCL code only

Example:
proc example_var {args} {
    if {[llength $args] > 0} {
        set val [lindex $args 0]
        puts "Variable set: example_var = $val"
    } else {
        puts "Variable: example_var (controls XYZ behavior)"
    }
    return ""
}`
        };
    }

    // 命令：格式化参数列表
    const optList = (options || []).map(o =>
        `  ${o.name} | ${o.type} | ${o.description || ''}`
    ).join('\n');

    if (lang === 'cn') {
        // 读取 MD 文件作为 system prompt（完整规则）
        const promptFile = path.join(ROOT, 'prompts', 'cn', 'simulation-prompt.md');
        let systemPrompt = '';
        if (fs.existsSync(promptFile)) {
            systemPrompt = fs.readFileSync(promptFile, 'utf-8');
        }
        if (!systemPrompt) {
            systemPrompt = '你是 Innovus EDA 仿真专家。只输出 TCL proc 代码，不输出解释。';
        }

        // User prompt: 命令数据
        const userPrompt = `为命令 "${command}" 生成仿真 proc。

## 命令基本信息
- 摘要: ${summary}
- 描述: ${description || '无'}
- 用法: ${usage || '无'}

## 参数列表（名称 | 类型 | 描述）
${optList || '  (无参数)'}

请根据 system prompt 中的规则生成 TCL proc 代码。`;

        return { system: systemPrompt, user: userPrompt };
    }

    // English prompt — also load from MD file
    const enPromptFile = path.join(ROOT, 'prompts', 'en', 'simulation-prompt.md');
    let enSystem = 'You are an Innovus EDA simulation expert. Output only TCL proc code. NO desc_map, NO array set.';
    if (fs.existsSync(enPromptFile)) {
        enSystem = fs.readFileSync(enPromptFile, 'utf-8');
    }

    const enUserPrompt = `Generate TCL proc for Innovus command "${command}".

Summary: ${summary}
Options (name | type | description):
${optList || '  (none)'}

Follow the rules in the system prompt exactly.`;

    return { system: enSystem, user: enUserPrompt };
}

// ════════════════════════════════════════════════════════════
//  API 调用
// ════════════════════════════════════════════════════════════

async function callAPI(systemPrompt, userPrompt, opts = {}) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('DEEPSEEK_API_KEY not set');
    const retries = opts.retries || 0;
    const maxRetries = opts.maxRetries || MAX_RETRIES;

    try {
        const resp = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                temperature: opts.temperature || 0.3, stream: false
            }),
            signal: AbortSignal.timeout(60000)
        });

        if (resp.status === 429 && retries < maxRetries) {
            await sleep(RETRY_DELAY * (retries + 1));
            return callAPI(systemPrompt, userPrompt, { ...opts, retries: retries + 1 });
        }
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`API ${resp.status}: ${t.substring(0, 200)}`);
        }
        const data = await resp.json();
        return extractProc(data.choices?.[0]?.message?.content || '');

    } catch (e) {
        if (retries < maxRetries && e.name !== 'AbortError') {
            await sleep(RETRY_DELAY);
            return callAPI(systemPrompt, userPrompt, { ...opts, retries: retries + 1 });
        }
        throw e;
    }
}

function extractProc(text) {
    let code = text.replace(/```tcl\n?/gi, '').replace(/```\n?/g, '').trim();
    if (/^proc\s+\w+/i.test(code)) return code;
    const m = code.match(/proc\s+\w+\s*\{[^}]*\}\s*\{[\s\S]+/i);
    return m ? m[0] : '';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════
//  主流程
// ════════════════════════════════════════════════════════════

async function processLang(lang) {
    const helpDir = path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', lang, 'help');
    const simDir = path.join(ROOT, 'data', 'simulations', lang);
    fs.mkdirSync(simDir, { recursive: true });

    const files = fs.readdirSync(helpDir).filter(f => f.endsWith('.json')).sort();
    // 如果指定了 --cmds，只处理这些命令
    const filteredFiles = TARGET_CMDS
        ? files.filter(f => TARGET_CMDS.has(f.replace('help_', '').replace('.json', '')))
        : files;
    if (TARGET_CMDS) {
        mainLog.log(`[${lang}] 目标命令: ${TARGET_CMDS.size} 个, 匹配到 ${filteredFiles.length} 个`);
    }
    const total = LIMIT > 0 ? Math.min(LIMIT, filteredFiles.length) : filteredFiles.length;

    const TCL_BUILTINS = new Set(['Puts', 'set', 'if', 'while', 'for', 'foreach', 'proc', 'return', 'expr',
        'source', 'catch', 'error', 'list', 'concat', 'lindex', 'llength', 'lappend', 'split', 'join',
        'regexp', 'regsub', 'open', 'close', 'gets', 'read', 'file', 'glob', 'cd', 'pwd', 'exec', 'eval',
        'uplevel', 'upvar', 'namespace', 'variable', 'array', 'string', 'format', 'scan', 'clock', 'info']);

    // 通过文件系统对比：已有仿真文件自动跳过
    const existingCount = files.filter(f => {
        const name = f.replace('help_', '').replace('.json', '');
        return fs.existsSync(path.join(simDir, `${name}.tcl`));
    }).length;
    const pendingCount = total - existingCount;

    mainLog.log(`[${lang}] 总计 ${files.length} 命令, 处理 ${total}, 已有 ${existingCount}, 待生成 ${pendingCount}, 并发=${CONCURRENCY}`);

    if (DRY_RUN) {
        const info = JSON.parse(fs.readFileSync(path.join(helpDir, files[0]), 'utf-8'));
        const p = buildPrompt(info, lang);
        mainLog.log(`[DRY RUN] System: ${p.system.substring(0, 80)}`);
        mainLog.log(`[DRY RUN] User: ${p.user.substring(0, 500)}`);
        return;
    }

    let completed = 0, skipped = 0, failed = 0;
    const t0 = Date.now();
    const queue = filteredFiles.slice(0, total);
    let idx = 0;

    // 预先统计跳过的文件数（.tcl 已存在 + 变体 + 内置命令）
    let preSkipped = 0;
    for (const f of queue) {
        const name = f.replace('help_', '').replace('.json', '');
        // 已有 .tcl 文件
        if (fs.existsSync(path.join(simDir, `${name}.tcl`))) { preSkipped++; continue; }
        // 变体条目（cmdName 含空格+数字后缀）
        if (/\s+\d+$/.test(name)) { preSkipped++; continue; }
    }
    const needGenerate = total - preSkipped;
    if (preSkipped > 0) {
        console.log(`[${lang}] 📦 跳过 ${preSkipped} 个 (已有文件 + 变体条目)`);
    }
    console.log(`[${lang}] 🔧 需生成 ${needGenerate} 个 (共 ${total})`);

    // 进度条
    const BAR_WIDTH = 30;
    let lastProgressLine = '';
    function progressBar(current, max) {
        const pct = (current / max * 100).toFixed(1);
        const filled = Math.round(current / max * BAR_WIDTH);
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        return `[${bar}] ${pct}% 跳过${skipped} 生成${completed} 失败${failed} ${el}s`;
    }

    function drawProgress(current, max) {
        const line = progressBar(current, max);
        // 清除上一行并重绘（\r 回到行首，空格清除残留字符）
        if (lastProgressLine) {
            process.stdout.write('\r' + ' '.repeat(lastProgressLine.length) + '\r');
        }
        process.stdout.write(line);
        lastProgressLine = line;
    }

    // 定期刷新进度（每 3 秒）
    let progressTimer = setInterval(() => {
        const current = completed + skipped + failed;
        if (current > 0 && current < total) {
            drawProgress(current, total);
        }
    }, 3000);

    // 任何 worker 输出到控制台时，先换行再输出，然后重绘进度
    function consoleLog(msg) {
        // 清除当前进度行
        if (lastProgressLine) {
            process.stdout.write('\r' + ' '.repeat(lastProgressLine.length) + '\r');
        }
        console.log(msg);
        // 重绘进度
        const current = completed + skipped + failed;
        if (current > 0 && current < total) {
            drawProgress(current, total);
        }
    }

    async function worker(workerId) {
        const wl = workerLogs[workerId];
        while (idx < queue.length) {
            const file = queue[idx++];
            const cmdName = file.replace('help_', '').replace('.json', '');
            const simFile = path.join(simDir, `${cmdName}.tcl`);

            // 跳过已有仿真文件（直接比对文件系统）
            if (fs.existsSync(simFile)) {
                skipped++;
                continue;
            }

            try {
                // 跳过变体条目（cmdName 含空格+数字后缀，如 "readSdpFile 2"）
                if (/\s+\d+$/.test(cmdName)) {
                    skipped++;
                    continue;
                }

                const info = JSON.parse(fs.readFileSync(path.join(helpDir, file), 'utf-8'));

                // TCL 纯内置命令（非 Innovus 特有）直接跳过
                if (TCL_BUILTINS.has(info.command) && info.is_cmd === false) {
                    skipped++;
                    continue;
                }

                const { system, user } = buildPrompt(info, lang);

                // 第一次尝试
                let tcl = await callAPI(system, user);
                let retried = false;

                // 如果无 proc 或括号不匹配，重试
                if (!tcl.includes('proc ')) {
                    const msg = `🔁 [${lang}] ${cmdName}(${info.summary?.substring(0, 30)}) 无proc → 重试`;
                    wl.log(msg); consoleLog(msg);
                    tcl = await callAPI(system, user, { temperature: 0.1, maxRetries: 1 });
                    retried = true;
                }

                if (tcl.includes('proc ')) {
                    const openB = (tcl.match(/\{/g) || []).length;
                    const closeB = (tcl.match(/\}/g) || []).length;
                    if (openB !== closeB) {
                        const msg = `🔁 [${lang}] ${cmdName}(${info.summary?.substring(0, 30)}) {${openB}/}${closeB} → 重试`;
                        wl.log(msg); consoleLog(msg);
                        tcl = await callAPI(system, user, { temperature: 0.1, maxRetries: 1 });
                        retried = true;
                    }
                }

                // 最终验证
                if (!tcl.includes('proc ')) {
                    const msg = `⚠ [${lang}] ${cmdName}(${info.summary?.substring(0, 40)}) 重试${retried ? '后' : ''}仍无proc`;
                    wl.log(msg); consoleLog(msg);
                    failed++;
                    continue;
                }

                const openBraces = (tcl.match(/\{/g) || []).length;
                const closeBraces = (tcl.match(/\}/g) || []).length;
                if (openBraces !== closeBraces) {
                    const msg = `⚠ [${lang}] ${cmdName}(${info.summary?.substring(0, 40)}) 重试${retried ? '后' : ''}括号{${openBraces}/}${closeBraces}`;
                    wl.log(msg); consoleLog(msg);
                    failed++;
                    continue;
                }

                fs.writeFileSync(simFile, tcl.trim() + '\n', 'utf-8');

                completed++;

                // 成功详情写入 worker log（每 50 条写一次）
                if (completed % 50 === 0) {
                    wl.log(`✅ [${lang}] ${cmdName}(${info.summary?.substring(0, 40)}) 已完成`);
                }

                // 每 50 条更新进度条
                if (completed % 50 === 0) {
                    drawProgress(completed + skipped + failed, total);
                    mainLog.log(`[${lang}] ${progressBar(completed + skipped + failed, total)} 最近: ${cmdName}`);
                }

            } catch (e) {
                const msg = `❌ [${lang}] ${cmdName} 异常: ${e.message.substring(0, 100)}`;
                wl.log(msg); consoleLog(msg);
                failed++;
            }
        }
        wl.flush();
    }

    // 并发执行
    const workerCount = Math.min(CONCURRENCY, queue.length);
    await Promise.all(Array(workerCount).fill(null).map((_, i) => worker(i)));

    // 最终保存
    if (progressTimer) clearInterval(progressTimer);
    // 清除进度行并打印完成行
    if (lastProgressLine) {
        process.stdout.write('\r' + ' '.repeat(lastProgressLine.length) + '\r');
    }
    console.log(progressBar(total, total));
    mainLog.flush();
    for (const wl of workerLogs) wl.flush();

    const el = ((Date.now() - t0) / 1000).toFixed(0);
    mainLog.log(`[${lang}] ✅${completed} ⏭${skipped} ❌${failed} (${el}s)`);
    if (failed > 0) {
        mainLog.log(`[${lang}] 💡 ${failed} 个失败详见 worker-*.log，下次运行自动重试`);
    }
}


async function main() {
    mainLog.log('═══════════════════════════════════════');
    mainLog.log(`启动: 语言=${LANGS.join(',')} 并发=${CONCURRENCY} 限制=${LIMIT || '无'}`);
    mainLog.log(`日志: ${LOG_DIR}`);
    mainLog.log(`模式: 文件系统对比（已有仿真自动跳过）`);

    for (const lang of LANGS) {
        await processLang(lang);
    }

    mainLog.log('═══════════════════════════════════════');
    mainLog.log('全部完成');
    mainLog.flush();
}

main().catch(e => {
    mainLog.log(`❌ 致命错误: ${e.message}`);
    mainLog.flush();
    process.exit(1);
});
