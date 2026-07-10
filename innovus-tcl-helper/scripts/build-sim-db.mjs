#!/usr/bin/env node
/**
 * 仿真数据库构建 — 将 data/simulations/<lang>/*.tcl 合并为单个 .db.tcl
 * 使用 head 版本构建
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SIM_DIR = path.join(ROOT, 'data', 'simulations');

const args = process.argv.slice(2);
const LANGS = args.includes('--lang')
    ? [args[args.indexOf('--lang') + 1]]
    : ['cn', 'en'];

for (const lang of LANGS) {
    const srcDir = path.join(SIM_DIR, lang);
    const dbFile = path.join(SIM_DIR, `${lang}.db.tcl`);

    if (!fs.existsSync(srcDir)) { console.log(`  ⚠ ${lang}: no dir`); continue; }

    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.tcl')).sort();
    const lines = [`# Innovus Sim DB — ${lang.toUpperCase()} — ${files.length} procs — ${new Date().toISOString().slice(0, 10)}`, ''];

    for (const file of files) {
        const cmd = file.replace('.tcl', '');
        const code = fs.readFileSync(path.join(srcDir, file), 'utf-8').trim();
        lines.push(`# === BEGIN ${cmd} ===`);
        lines.push(code);
        lines.push(`# === END ${cmd} ===`);
        lines.push('');
    }

    fs.writeFileSync(dbFile, lines.join('\n'), 'utf-8');
    const srcKB = (files.reduce((s, f) => s + fs.statSync(path.join(srcDir, f)).size, 0) / 1024).toFixed(0);
    const dbKB = (fs.statSync(dbFile).size / 1024).toFixed(0);
    console.log(`  ✅ ${lang}: ${files.length} 文件, ${srcKB}KB → ${dbKB}KB`);
}
