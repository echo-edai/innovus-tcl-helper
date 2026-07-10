#!/usr/bin/env node
/**
 * 仿真参数名校验器 — 检查 .tcl 仿真文件中的参数名是否与 help JSON 完全一致
 *
 * 用法: node scripts/check-param-names.mjs [--lang cn]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LANG = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : 'cn';

const helpDir = path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', LANG, 'help');
const simDir = path.join(ROOT, 'data', 'simulations', LANG);

// 从 JSON 获取所有文档参数名
function getHelpParams(cmdName) {
    const f = path.join(helpDir, `help_${cmdName}.json`);
    if (!fs.existsSync(f)) return null;
    const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return {
        command: d.command,
        params: new Set((d.options || []).map(o => o.name)),
        isCmd: d.is_cmd
    };
}

// 从 .tcl 提取所有 -xxx 参数引用
function getTclParams(cmdName) {
    const f = path.join(simDir, `${cmdName}.tcl`);
    if (!fs.existsSync(f)) return null;
    const tcl = fs.readFileSync(f, 'utf-8');
    // 提取所有 -word 形式的参数引用（在 desc_map、switch、info exists 等上下文中）
    const matches = tcl.match(/-[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    // 过滤掉 proc 参数名、TCL 内置等
    const params = new Set();
    for (const m of matches) {
        // 跳过明显的非参数：-exact, -glob, -regexp, -nocase 等 TCL switch 选项
        if (/^-(exact|glob|regexp|nocase|help|reset|true|false|yes|no|on|off|1|0)$/.test(m)) continue;
        params.add(m);
    }
    // 也提取 desc_map 中的 key
    const descMapMatch = tcl.match(/array set desc_map \{([^}]+)\}/s);
    if (descMapMatch) {
        const keys = descMapMatch[1].match(/-[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
        for (const k of keys) {
            if (!/^-(exact|glob|regexp|nocase)$/.test(k)) params.add(k);
        }
    }
    // 提取 switch 中的 case 值（"-xxx" 形式）
    const switchKeys = tcl.match(/\"(-[a-zA-Z_][a-zA-Z0-9_]*)\"/g) || [];
    for (const k of switchKeys) {
        const clean = k.replace(/"/g, '');
        if (!/^-(exact|glob|regexp|nocase)$/.test(clean)) params.add(clean);
    }
    return { command: cmdName, params };
}

async function main() {
    const helpFiles = fs.readdirSync(helpDir).filter(f => f.endsWith('.json')).sort();
    let total = 0, ok = 0, missing = 0, withExtra = 0, noSim = 0;
    const issues = [];

    for (const hf of helpFiles) {
        const cmdName = hf.replace('help_', '').replace('.json', '');
        const help = getHelpParams(cmdName);
        if (!help) continue;
        total++;

        const tcl = getTclParams(cmdName);
        if (!tcl) { noSim++; continue; } // 无仿真文件

        // 检查 .tcl 中的参数是否在 help 中
        const extra = [...tcl.params].filter(p => !help.params.has(p));
        // help 中的参数在 .tcl 中缺失
        const absent = [...help.params].filter(p => !tcl.params.has(p));

        if (extra.length === 0 && absent.length === 0) {
            ok++;
        } else {
            if (extra.length > 0) withExtra++;
            if (absent.length > 0) missing++;
            issues.push({ cmd: cmdName, extra, absent, paramCount: help.params.size });
        }
    }

    // 输出结果
    console.log('═══════════════════════════════════════');
    console.log(`  参数名校验报告 (${LANG})`);
    console.log('═══════════════════════════════════════');
    console.log(`  总计命令: ${total}`);
    console.log(`  ✅ 完全匹配: ${ok}`);
    console.log(`  ❌ .tcl 有多余参数 (不在help中): ${withExtra}`);
    console.log(`  ⚠️  help参数在.tcl中缺失: ${missing}`);
    console.log(`  📁 无仿真文件: ${noSim}`);

    // 按多余参数数量排序，显示 top 20
    console.log('');
    console.log('── 多余参数 Top 20 ──');
    issues.sort((a, b) => b.extra.length - a.extra.length);
    for (const issue of issues.slice(0, 20)) {
        console.log(`  ${issue.cmd} (help有${issue.paramCount}参数, 多余${issue.extra.length}个, 缺失${issue.absent.length}个)`);
        if (issue.extra.length <= 10) {
            console.log(`    多余: ${issue.extra.join(', ')}`);
        } else {
            console.log(`    多余(前10): ${issue.extra.slice(0, 10).join(', ')}...`);
        }
        if (issue.absent.length > 0 && issue.absent.length <= 10) {
            console.log(`    缺失: ${issue.absent.join(', ')}`);
        }
    }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
