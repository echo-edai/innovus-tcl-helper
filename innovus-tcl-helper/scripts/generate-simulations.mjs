#!/usr/bin/env node
/**
 * Innovus 命令仿真数据生成器 — DeepSeek Flash API
 *
 * 用法: node scripts/generate-simulations.mjs [--lang cn|en] [--limit N] [--dry-run]
 * 需要: export DEEPSEEK_API_KEY=xxx
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const API = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-v4-flash';
const CONCURRENCY = 3;
const MAX_TOKENS = 2048;
const RETRY_DELAY = 2000;
const MAX_RETRIES = 3;

const args = process.argv.slice(2);
const LANGS = args.includes('--lang') ? [args[args.indexOf('--lang') + 1]] : ['cn', 'en'];
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;
const DRY_RUN = args.includes('--dry-run');

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
1. proc 必须解析 args 中的关键参数，根据用户传入的实际值生成对应的中文 puts 输出
2. 输出描述要让工程师一眼看懂命令做了什么操作、用了什么参数
3. 例如：用户传入 -width 10 -spacing 5，输出 "宽度设为 10, 间距设为 5"
4. 如果是创建类命令（add/create），输出创建了什么对象
5. 如果是设置类命令（set），输出设置了什么值
6. 如果是报告类命令（report），输出关键指标
7. 不认识的参数忽略，不要报错
8. 返回空字符串 ""

## 输出格式（只输出代码，不要解释）
proc ${command} {args} {
    # 解析关键参数...
    # 根据参数值 puts 中文描述...
    return ""
}`
        };
    } else {
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
1. Parse key args and generate English puts output based on actual values
2. Describe what the command did with which parameters
3. Example: -width 10 -spacing 5 → output "Width set to 10, spacing set to 5"
4. For create commands, describe what was created
5. For set commands, describe what was set
6. For report commands, output key metrics
7. Unknown params silently ignored
8. Return empty string

## Output Format (code only)
proc ${command} {args} {
    # Parse key args...
    # Generate descriptive puts output...
    return ""
}`
        };
    }
}

async function callAPI(systemPrompt, userPrompt, retries = 0) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('DEEPSEEK_API_KEY not set');

    try {
        const resp = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                temperature: 0.3, max_tokens: MAX_TOKENS, stream: false
            }),
            signal: AbortSignal.timeout(60000)
        });

        if (resp.status === 429 && retries < MAX_RETRIES) {
            await sleep(RETRY_DELAY * (retries + 1));
            return callAPI(systemPrompt, userPrompt, retries + 1);
        }
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`API ${resp.status}: ${t.substring(0, 200)}`);
        }
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';
        return extractProc(content);

    } catch (e) {
        if (retries < MAX_RETRIES && e.name !== 'AbortError') {
            await sleep(RETRY_DELAY);
            return callAPI(systemPrompt, userPrompt, retries + 1);
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

async function processLang(lang) {
    const helpDir = path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', lang, 'help');
    const simDir = path.join(ROOT, 'data', 'simulations', lang);
    fs.mkdirSync(simDir, { recursive: true });

    const files = fs.readdirSync(helpDir).filter(f => f.endsWith('.json')).sort();
    const total = LIMIT > 0 ? Math.min(LIMIT, files.length) : files.length;

    const TCL_BUILTINS = new Set(['Puts', 'set', 'if', 'while', 'for', 'foreach', 'proc', 'return', 'expr', 'source', 'catch', 'error', 'list', 'concat', 'lindex', 'llength', 'lappend', 'split', 'join', 'regexp', 'regsub', 'open', 'close', 'gets', 'read', 'file', 'glob', 'cd', 'pwd', 'exec', 'eval', 'uplevel', 'upvar', 'namespace', 'variable', 'array', 'string', 'format', 'scan', 'clock', 'info', 'rename', 'interp', 'trace', 'unset', 'append', 'incr', 'switch', 'after', 'vwait', 'update']);

    console.log(`\n📊 [${lang}] 总计 ${files.length} 个命令，处理 ${total} 个 (并发=${CONCURRENCY})`);

    if (DRY_RUN) {
        const info = JSON.parse(fs.readFileSync(path.join(helpDir, files[0]), 'utf-8'));
        const p = buildPrompt(info, lang);
        console.log('System:', p.system.substring(0, 80));
        console.log('User:', p.user.substring(0, 500));
        return { completed: 0, skipped: 0, failed: 0 };
    }

    let completed = 0, skipped = 0, failed = 0;
    const t0 = Date.now();
    const queue = files.slice(0, total);
    let idx = 0;

    async function worker() {
        while (idx < queue.length) {
            const file = queue[idx++];
            const cmdName = file.replace('help_', '').replace('.json', '');
            const simFile = path.join(simDir, `${cmdName}.json`);

            if (fs.existsSync(simFile)) { skipped++; continue; }

            try {
                const info = JSON.parse(fs.readFileSync(path.join(helpDir, file), 'utf-8'));
                if (!info.is_cmd || TCL_BUILTINS.has(info.command)) { skipped++; continue; }

                const { system, user } = buildPrompt(info, lang);
                const tcl = await callAPI(system, user);

                if (!tcl.includes('proc ')) {
                    console.log(`  ⚠ [${lang}] ${cmdName}: 无 proc → 跳过`);
                    failed++; continue;
                }

                fs.writeFileSync(simFile, JSON.stringify({
                    command: cmdName, tcl,
                    generated: new Date().toISOString(), model: MODEL
                }, null, 2), 'utf-8');
                completed++;

                const pct = ((completed + skipped + failed) / total * 100).toFixed(1);
                const el = ((Date.now() - t0) / 1000).toFixed(0);
                console.log(`  ✅ [${lang}] ${cmdName} [${completed}/${total}] ${pct}% (${el}s)`);

            } catch (e) {
                console.error(`  ❌ [${lang}] ${cmdName}: ${e.message}`);
                failed++;
            }
        }
    }

    await Promise.all(Array(Math.min(CONCURRENCY, queue.length)).fill(null).map(() => worker()));

    const el = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`\n[${lang}] ✅${completed} ⏭${skipped} ❌${failed} (${el}s)`);
    return { completed, skipped, failed };
}

async function main() {
    let totalComp = 0, totalSkip = 0, totalFail = 0;
    for (const lang of LANGS) {
        const r = await processLang(lang);
        totalComp += r.completed; totalSkip += r.skipped; totalFail += r.failed;
    }
    console.log(`\n═══════════════════════════════════════`);
    console.log(`全部: ✅${totalComp} ⏭${totalSkip} ❌${totalFail}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
