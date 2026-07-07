#!/usr/bin/env node
/**
 * 打包前预处理：确保 data/cmds/ 和 data/example/ 目录存在
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`  📁 创建目录: ${path.relative(ROOT, dirPath)}`);
    }
}

function main() {
    console.log('📦 检查 data/ 目录结构 ...');

    ensureDir(path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', 'cn', 'help'));
    ensureDir(path.join(ROOT, 'data', 'cmds', 'innovus', '25.1', 'en', 'help'));
    ensureDir(path.join(ROOT, 'data', 'cmds', 'innovus', 'test', 'cn', 'help'));
    ensureDir(path.join(ROOT, 'data', 'cmds', 'innovus', 'test', 'en', 'help'));
    ensureDir(path.join(ROOT, 'data', 'example', 'innovus'));
    ensureDir(path.join(ROOT, 'data', 'cache', 'cn'));
    ensureDir(path.join(ROOT, 'data', 'cache', 'en'));

    console.log('✅ data/ 目录结构就绪');
}

main();
