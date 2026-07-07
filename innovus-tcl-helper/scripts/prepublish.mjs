#!/usr/bin/env node
/**
 * 打包前预处理：确保 data/innovus/ 目录存在
 *
 * 数据文件由用户直接在 data/innovus/ 下管理，prepublish 不再复制。
 * 仅确保必要的空目录结构存在。
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
    console.log('📦 检查 data/innovus/ 目录结构 ...');

    ensureDir(path.join(ROOT, 'data', 'innovus', '25.1', 'cn', 'help'));
    ensureDir(path.join(ROOT, 'data', 'innovus', '25.1', 'en', 'help'));
    ensureDir(path.join(ROOT, 'data', 'innovus', 'test', 'cn', 'help'));
    ensureDir(path.join(ROOT, 'data', 'innovus', 'test', 'en', 'help'));

    console.log('✅ data/innovus/ 目录结构就绪');
}

main();
