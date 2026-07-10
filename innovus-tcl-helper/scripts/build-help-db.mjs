#!/usr/bin/env node
/**
 * Help 数据库构建 — 将 data/cmds/innovus/25.1/<lang>/help/*.json 合并为 .db.json
 * 格式: {"commands": {"cmdName": {...json...}, ...}}
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CMD_DIR = path.join(ROOT, 'data', 'cmds', 'innovus', '25.1');

const args = process.argv.slice(2);
const LANGS = args.includes('--lang')
    ? [args[args.indexOf('--lang') + 1]]
    : ['cn', 'en'];

for (const lang of LANGS) {
    const srcDir = path.join(CMD_DIR, lang, 'help');
    const dbFile = path.join(CMD_DIR, lang, 'help.db.json');

    if (!fs.existsSync(srcDir)) {
        console.log(`  ⚠ ${lang}: 目录不存在`);
        continue;
    }

    const files = fs.readdirSync(srcDir)
        .filter(f => f.endsWith('.json'))
        .sort();

    const commands = {};
    for (const file of files) {
        try {
            const content = JSON.parse(fs.readFileSync(path.join(srcDir, file), 'utf-8'));
            if (content.command) {
                commands[content.command] = content;
            }
        } catch { /* skip bad files */ }
    }

    const db = { commands, _meta: { lang, count: Object.keys(commands).length, generated: new Date().toISOString() } };
    fs.writeFileSync(dbFile, JSON.stringify(db), 'utf-8');

    const srcSize = files.reduce((s, f) => s + fs.statSync(path.join(srcDir, f)).size, 0);
    const dbSize = fs.statSync(dbFile).size;
    console.log(`  ✅ ${lang}: ${files.length} 文件, ${(srcSize / 1024).toFixed(0)}KB → ${(dbSize / 1024).toFixed(0)}KB (${(dbSize / srcSize * 100).toFixed(1)}%)`);
}
