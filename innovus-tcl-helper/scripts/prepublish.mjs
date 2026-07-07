#!/usr/bin/env node
/**
 * 打包前预处理：复制 data_base 中的命令 JSON 到扩展内 data/ 目录
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_SRC = path.join(ROOT, '..', 'data_base');
const DATA_DST = path.join(ROOT, 'data');

function copyDir(src, dst, filter = () => true) {
    if (!fs.existsSync(src)) { return 0; }
    fs.mkdirSync(dst, { recursive: true });
    let count = 0;
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            count += copyDir(srcPath, dstPath, filter);
        } else if (filter(entry.name)) {
            fs.copyFileSync(srcPath, dstPath);
            count++;
        }
    }
    return count;
}

function main() {
    console.log('📦 复制命令数据到扩展内 data/ ...');

    if (fs.existsSync(DATA_DST)) {
        execSync(`rm -rf "${DATA_DST}"`);
    }

    let total = 0;

    total += copyDir(
        path.join(DATA_SRC, 'cn', 'help'),
        path.join(DATA_DST, 'cn', 'help'),
        f => f.endsWith('.json')
    );

    total += copyDir(
        path.join(DATA_SRC, 'en', 'help'),
        path.join(DATA_DST, 'en', 'help'),
        f => f.endsWith('.json')
    );

    console.log(`✅ 已复制 ${total} 个 JSON 文件到 data/`);
    console.log('   扩展打包后将包含内置数据，无需外部 data_base/');
}

main();
