#!/usr/bin/env node
/**
 * Innovus 命令仿真数据生成器 — 调用 DeepSeek Flash API
 *
 * 流程:
 *   1. 读取每个命令的 help JSON
 *   2. 构造 prompt 发送给 DeepSeek Flash
 *   3. AI 返回 TCL puts 仿真代码
 *   4. 保存到 data/simulations/<lang>/<command>.json
 *
 * 用法:
 *   node scripts/generate-simulations.mjs [--lang zh|en] [--limit N] [--dry-run]
 *
 * 环境变量:
 *   DEEPSEEK_API_KEY — DeepSeek API Key
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ════════════════════════════════════════════════════════════
//  配置
// ════════════════════════════════════════════════════════════

const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-v4-flash';
const CONCURRENCY = 3;          // 并发数
const RETRY_DELAY = 2000;       // 限流重试间隔 (ms)
const MAX_RETRIES = 3;

// ════════════════════════════════════════════════════════════
//  命令行参数
// ════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const LANG = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'cn';
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;
const DRY_RUN = args.includes('--dry-run');

// ════════════════════════════════════════════════════════════
//  Prompt 模板
// ════════════════════════════════════════════════════════════

function buildPrompt(cmdInfo) {
    const { command, summary, description, usage, options } = cmdInfo;

    const optLines = (options || []).map(o =>
        `  ${o.name} (${o.required ? '必选' : '可选'}, ${o.type}): ${o.description}`
    ).join('\n');

    return `你是 Cadence Innovus EDA 工具的仿真器。请为以下 Innovus 命令生成一个 TCL proc 包装器，用 puts 语句模拟该命令在真实 Innovus 环境中运行时会输出的信息和结果。

## 命令信息
- 命令名: ${command}
- 摘要: ${summary}
- 详细描述: ${description}
- 用法: ${usage}
- 参数:
${optLines || '  (无参数)'}

## 输出要求
1. 生成一个完整的 TCL proc，格式为: proc ${command} {args} { ... }
2. 用 puts 输出命令执行的关键信息（如创建了什么、设置了什么值、操作结果等）
3. 仿真输出应简短但真实，模拟 Innovus 实际运行时的输出风格
4. 对于返回值的命令，用 return 返回模拟结果
5. 不要输出 markdown 标记，只输出纯 TCL 代码
6. 代码中不要出现你的思考过程，只输出最终代码

## Innovus 典型输出风格
- 操作成功: "Created core ring with 2 nets on layers {M1 M9}"
- 设置值: "Set variable X to value Y"
- 警告: "WARNING: No objects found matching criteria"
- 错误: "ERROR: Invalid parameter value"
- 报告: 表格或键值对格式

请直接输出 TCL 代码:`;
}

// ════════════════════════════════════════════════════════════
//  API 调用
// ════════════════════════════════════════════════════════════

async function callDeepSeek(prompt, retries = 0) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        throw new Error('未设置 DEEPSEEK_API_KEY 环境变量');
    }

    try {
        const resp = await fetch(DEEPSEEK_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: '你是一个 EDA 工具仿真专家，只输出 TCL 代码。' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 1024,
                stream: false
            }),
            signal: AbortSignal.timeout(30000)
        });

        if (resp.status === 429 && retries < MAX_RETRIES) {
            const delay = RETRY_DELAY * (retries + 1);
            console.log(`  ⏳ 限流，${delay}ms 后重试...`);
            await sleep(delay);
            return callDeepSeek(prompt, retries + 1);
        }

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
        }

        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';
        return extractTclCode(content);

    } catch (e) {
        if (retries < MAX_RETRIES && e.name !== 'AbortError') {
            console.log(`  ⚠ 重试 ${retries + 1}/${MAX_RETRIES}: ${e.message}`);
            await sleep(RETRY_DELAY);
            return callDeepSeek(prompt, retries + 1);
        }
        throw e;
    }
}

/** 从 AI 回复中提取纯 TCL 代码 */
function extractTclCode(text) {
    // 移除可能的 markdown 代码块标记
    let code = text.replace(/```tcl\n?/gi, '').replace(/```\n?/g, '').trim();

    // 如果以 proc 开头，直接使用
    if (/^proc\s+\w+/i.test(code)) {
        return code;
    }

    // 尝试提取第一个 proc 块（支持多行和不完整代码）
    const procMatch = code.match(/proc\s+\w+\s*\{[^}]*\}\s*\{[\s\S]+/i);
    if (procMatch) {
        return procMatch[0];
    }

    // 如果 AI 返回了 TCL 代码但没有 proc 包装，尝试包装
    if (code.length > 20 && (code.includes('puts ') || code.includes('return '))) {
        // 无法提取 proc，返回原始内容
        return code;
    }

    // 如果只有纯文本描述，生成基础 proc
    return '';
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ════════════════════════════════════════════════════════════
//  主流程
// ════════════════════════════════════════════════════════════

async function main() {
    const helpDir = path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', LANG, 'help');
    const simDir = path.join(ROOT, 'data', 'simulations', LANG);
    fs.mkdirSync(simDir, { recursive: true });

    const files = fs.readdirSync(helpDir)
        .filter(f => f.endsWith('.json'))
        .sort();

    const total = LIMIT > 0 ? Math.min(LIMIT, files.length) : files.length;
    console.log(`📊 总计 ${files.length} 个命令，本次处理 ${total} 个 (并发=${CONCURRENCY})`);
    console.log(`📂 帮助目录: ${helpDir}`);
    console.log(`📂 输出目录: ${simDir}`);
    console.log('');

    if (DRY_RUN) {
        console.log('🔍 DRY RUN 模式 — 仅打印 prompt，不调用 API');
        const sample = files[0];
        const info = JSON.parse(fs.readFileSync(path.join(helpDir, sample), 'utf-8'));
        console.log(buildPrompt(info));
        return;
    }

    // 统计
    let completed = 0;
    let skipped = 0;
    let failed = 0;
    const startTime = Date.now();

    // 并发处理
    const queue = files.slice(0, total);
    const running = new Set();

    async function processFile(file) {
        const cmdName = file.replace('help_', '').replace('.json', '');
        const simFile = path.join(simDir, `${cmdName}.json`);

        // 跳过已生成的
        if (fs.existsSync(simFile)) {
            skipped++;
            return;
        }

        try {
            const info = JSON.parse(fs.readFileSync(path.join(helpDir, file), 'utf-8'));
            // 跳过非命令和内置 TCL 命令（它们由 tclsh 原生支持）
            const tclBuiltins = ['Puts', 'set', 'if', 'while', 'for', 'foreach', 'proc', 'return', 'expr', 'source', 'catch', 'error', 'list', 'concat', 'lindex', 'llength', 'lappend', 'split', 'join', 'regexp', 'regsub', 'open', 'close', 'gets', 'read', 'file', 'glob', 'cd', 'pwd', 'exec', 'eval', 'uplevel', 'upvar', 'namespace', 'variable', 'array', 'string', 'format', 'scan', 'clock', 'info', 'rename', 'interp', 'trace', 'unset', 'append', 'incr', 'switch', 'after', 'vwait', 'update', 'tk', 'wm', 'destroy', 'pack', 'grid', 'place'];
            if (!info.is_cmd || tclBuiltins.includes(info.command)) {
                skipped++;
                return;
            }

            const prompt = buildPrompt(info);
            const tclCode = await callDeepSeek(prompt);

            // 验证生成的代码包含 proc 定义
            if (!tclCode.includes('proc ')) {
                console.log(`  ⚠ ${cmdName}: 生成结果不含 proc，跳过`);
                failed++;
                return;
            }

            const simData = {
                command: cmdName,
                tcl: tclCode,
                generated: new Date().toISOString(),
                model: MODEL
            };

            fs.writeFileSync(simFile, JSON.stringify(simData, null, 2), 'utf-8');
            completed++;

            // 进度
            const pct = ((completed + skipped + failed) / total * 100).toFixed(1);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            console.log(`  ✅ ${cmdName} [${completed}/${total}] ${pct}% (${elapsed}s)`);

        } catch (e) {
            console.error(`  ❌ ${cmdName}: ${e.message}`);
            failed++;
        }
    }

    // 简单的并发控制
    let idx = 0;
    async function worker() {
        while (idx < queue.length) {
            const file = queue[idx++];
            running.add(file);
            await processFile(file);
            running.delete(file);
        }
    }

    const workers = Array(Math.min(CONCURRENCY, queue.length))
        .fill(null)
        .map(() => worker());

    await Promise.all(workers);

    // 汇总
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log(`✅ 完成: ${completed}  |  ⏭ 跳过: ${skipped}  |  ❌ 失败: ${failed}`);
    console.log(`⏱ 总耗时: ${((Date.now() - startTime) / 1000).toFixed(0)}s`);
    console.log(`📂 输出: ${simDir}`);
}

main().catch(e => {
    console.error('脚本异常:', e.message);
    process.exit(1);
});
