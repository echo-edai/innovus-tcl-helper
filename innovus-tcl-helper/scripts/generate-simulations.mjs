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

const API = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-v4-flash';
const CONCURRENCY = args.includes('--concurrency')
    ? parseInt(args[args.indexOf('--concurrency') + 1])
    : 30;  // deepseek-v4-flash 并发上限 2500，30 安全快速
const MAX_TOKENS = 8192;   // 默认输出长度（1M 上下文，384K 最大输出）
const MAX_TOKENS_RETRY = 16384; // 重试时的输出长度
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
        console.log(msg);
        this.buffer.push(line);
        this.count++;
        if (this.buffer.length >= 50) { this.flush(); }
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
//  断点管理
// ════════════════════════════════════════════════════════════

class Checkpoint {
    constructor(lang) {
        this.file = path.join(ROOT, 'data', 'simulations', `.checkpoint-${lang}.json`);
    }
    load() {
        try { return new Set(JSON.parse(fs.readFileSync(this.file, 'utf-8'))); }
        catch { return new Set(); }
    }
    save(doneSet) {
        fs.writeFileSync(this.file, JSON.stringify([...doneSet]), 'utf-8');
    }
}

// ════════════════════════════════════════════════════════════
//  Prompt 模板
// ════════════════════════════════════════════════════════════

function buildPrompt(cmdInfo, lang) {
    const { command, summary, description, usage, options } = cmdInfo;
    const optLines = (options || []).map(o =>
        `  ${o.name} (${o.required ? 'required' : 'optional'}, ${o.type}): ${o.description}`
    ).join('\n');

    if (lang === 'cn') {
        return {
            system: '你是 Innovus EDA 仿真专家。只输出 TCL proc 代码，不输出解释。',
            user: `为 Innovus 命令 "${command}" 生成一个 TCL proc 仿真包装器。

## 命令文档
- 摘要: ${summary}
- 描述: ${description}
- 用法: ${usage}
- 参数:
${optLines || '  (无)'}

## 关键要求
1. 解析 args 中的关键参数，根据用户传入的实际值生成中文 puts 输出
2. 让工程师一眼看懂命令做了什么操作、用了什么参数
3. 创建类命令输出创建了什么对象；设置类命令输出设置了什么值
4. 不认识的参数忽略，不要报错；返回空字符串 ""
5. 只输出 TCL 代码，不要解释

## 输出格式
proc ${command} {args} {
    # 解析关键参数...
    # 根据参数值 puts 中文描述...
    return ""
}`
        };
    }
    return {
        system: 'You are an Innovus EDA simulation expert. Output only TCL proc code.',
        user: `Generate a TCL proc wrapper for Innovus command "${command}".

## Command Info
- Summary: ${summary}
- Description: ${description}
- Usage: ${usage}
- Options:
${optLines || '  (none)'}

## Key Requirements
1. Parse key args, generate English puts output based on actual values
2. Describe what the command did with which parameters
3. Unknown params silently ignored; return empty string
4. Output TCL code only

## Format
proc ${command} {args} {
    # Parse key args...
    # Generate descriptive puts output...
    return ""
}`
    };
}

// ════════════════════════════════════════════════════════════
//  API 调用
// ════════════════════════════════════════════════════════════

async function callAPI(systemPrompt, userPrompt, opts = {}) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('DEEPSEEK_API_KEY not set');
    const maxTokens = opts.maxTokens || MAX_TOKENS;
    const retries = opts.retries || 0;
    const maxRetries = opts.maxRetries || MAX_RETRIES;

    try {
        const resp = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                temperature: opts.temperature || 0.3, max_tokens: maxTokens, stream: false
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
    const total = LIMIT > 0 ? Math.min(LIMIT, files.length) : files.length;

    const TCL_BUILTINS = new Set(['Puts', 'set', 'if', 'while', 'for', 'foreach', 'proc', 'return', 'expr',
        'source', 'catch', 'error', 'list', 'concat', 'lindex', 'llength', 'lappend', 'split', 'join',
        'regexp', 'regsub', 'open', 'close', 'gets', 'read', 'file', 'glob', 'cd', 'pwd', 'exec', 'eval',
        'uplevel', 'upvar', 'namespace', 'variable', 'array', 'string', 'format', 'scan', 'clock', 'info']);

    // 加载断点
    const checkpoint = new Checkpoint(lang);
    const doneSet = checkpoint.load();

    mainLog.log(`[${lang}] 总计 ${files.length} 命令, 处理 ${total}, 已完成 ${doneSet.size}, 并发=${CONCURRENCY}`);

    if (DRY_RUN) {
        const info = JSON.parse(fs.readFileSync(path.join(helpDir, files[0]), 'utf-8'));
        const p = buildPrompt(info, lang);
        mainLog.log(`[DRY RUN] System: ${p.system.substring(0, 80)}`);
        mainLog.log(`[DRY RUN] User: ${p.user.substring(0, 500)}`);
        return;
    }

    let completed = 0, skipped = 0, failed = 0;
    const t0 = Date.now();
    const queue = files.slice(0, total);
    let idx = 0;
    let saveTimer = null;

    // 定期保存断点（每 30 秒）
    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            checkpoint.save(doneSet);
            mainLog.log(`[${lang}] 💾 断点已保存 (${doneSet.size} 条)`);
            for (const wl of workerLogs) wl.flush();
        }, 30000);
    }

    async function worker(workerId) {
        const wl = workerLogs[workerId];
        while (idx < queue.length) {
            const file = queue[idx++];
            const cmdName = file.replace('help_', '').replace('.json', '');
            const simFile = path.join(simDir, `${cmdName}.json`);

            // 跳过已完成
            if (doneSet.has(cmdName) || fs.existsSync(simFile)) {
                doneSet.add(cmdName);
                skipped++;
                continue;
            }

            try {
                const info = JSON.parse(fs.readFileSync(path.join(helpDir, file), 'utf-8'));
                if (!info.is_cmd || TCL_BUILTINS.has(info.command)) {
                    doneSet.add(cmdName);
                    skipped++;
                    continue;
                }

                const { system, user } = buildPrompt(info, lang);

                // 第一次尝试
                let tcl = await callAPI(system, user);
                let retried = false;

                // 如果无 proc 或括号不匹配，用更高 max_tokens 重试
                if (!tcl.includes('proc ')) {
                    wl.log(`🔁 [${lang}] ${cmdName}(${info.summary?.substring(0, 30)}) 无proc → ${MAX_TOKENS_RETRY}tokens重试`);
                    tcl = await callAPI(system, user, { maxTokens: MAX_TOKENS_RETRY, temperature: 0.1, maxRetries: 1 });
                    retried = true;
                }

                if (tcl.includes('proc ')) {
                    const openB = (tcl.match(/\{/g) || []).length;
                    const closeB = (tcl.match(/\}/g) || []).length;
                    if (openB !== closeB) {
                        wl.log(`🔁 [${lang}] ${cmdName}(${info.summary?.substring(0, 30)}) {${openB}/}${closeB} → ${MAX_TOKENS_RETRY}tokens重试`);
                        tcl = await callAPI(system, user, { maxTokens: MAX_TOKENS_RETRY, temperature: 0.1, maxRetries: 1 });
                        retried = true;
                    }
                }

                // 最终验证
                if (!tcl.includes('proc ')) {
                    wl.log(`⚠ [${lang}] ${cmdName}(${info.summary?.substring(0, 40)}) 重试${retried ? '后' : ''}仍无proc`);
                    failed++;
                    continue;
                }

                const openBraces = (tcl.match(/\{/g) || []).length;
                const closeBraces = (tcl.match(/\}/g) || []).length;
                if (openBraces !== closeBraces) {
                    wl.log(`⚠ [${lang}] ${cmdName}(${info.summary?.substring(0, 40)}) 重试${retried ? '后' : ''}括号{${openBraces}/}${closeBraces}`);
                    failed++;
                    continue;
                }

                fs.writeFileSync(simFile, JSON.stringify({
                    command: cmdName, tcl,
                    generated: new Date().toISOString(), model: MODEL
                }, null, 2), 'utf-8');

                doneSet.add(cmdName);
                completed++;

                // 每 100 条打印一次进度到主日志
                if (completed % 100 === 0) {
                    const pct = ((completed + skipped + failed) / total * 100).toFixed(1);
                    const el = ((Date.now() - t0) / 1000).toFixed(0);
                    mainLog.log(`[${lang}] 进度: ${completed}/${total} (${pct}%), ${el}s`);
                }

                scheduleSave();

            } catch (e) {
                wl.log(`❌ [${lang}] ${cmdName} 异常: ${e.message.substring(0, 100)}`);
                failed++;
            }
        }
        wl.flush();
    }

    // 并发执行
    const workerCount = Math.min(CONCURRENCY, queue.length);
    await Promise.all(Array(workerCount).fill(null).map((_, i) => worker(i)));

    // 最终保存
    checkpoint.save(doneSet);
    mainLog.flush();
    for (const wl of workerLogs) wl.flush();

    const el = ((Date.now() - t0) / 1000).toFixed(0);
    mainLog.log(`[${lang}] 完成: ✅${completed} ⏭${skipped} ❌${failed} (${el}s)`);
    if (failed > 0) {
        mainLog.log(`[${lang}] 💡 失败命令详见 worker-*.log，下次运行自动重试`);
    }
}


async function main() {
    mainLog.log('═══════════════════════════════════════');
    mainLog.log(`启动: 语言=${LANGS.join(',')} 并发=${CONCURRENCY} 限制=${LIMIT || '无'}`);
    mainLog.log(`日志: ${LOG_DIR}`);
    mainLog.log(`断点: data/simulations/.checkpoint-<lang>.json`);

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
