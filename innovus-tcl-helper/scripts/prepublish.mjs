#!/usr/bin/env node
/**
 * 打包前预处理：复制 data_base 中的命令 JSON 到扩展内 data/ 目录
 *
 * 仅复制 cn/help/ 和 en/help/ 下的 JSON 文件（结构化数据），
 * 不复制原始 .log 文件以减小包体积。
 *
 * 复制后扩展可独立运行，无需外部 data_base/ 目录。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const DATA_SRC = path.join(ROOT, '..', 'data_base');
const DATA_DST = path.join(ROOT, 'data');

function copyDir(src, dst, filter) {
    if (!fs.existsSync(src)) {
        console.warn(`  ⚠️  跳过（源不存在）: ${path.relative(ROOT, src)}`);
        return 0;
    }
    fs.mkdirSync(dst, { recursive: true });
    let count = 0;
    for (const file of fs.readdirSync(src)) {
        if (filter && !filter(file)) { continue; }
        const srcFile = path.join(src, file);
        const dstFile = path.join(dst, file);
        if (fs.statSync(srcFile).isDirectory()) {
            count += copyDir(srcFile, dstFile, filter);
        } else {
            fs.copyFileSync(srcFile, dstFile);
            count++;
        }
    }
    return count;
}

function main() {
    console.log('📦 复制命令数据到扩展内 data/ ...');

    // 清空旧数据
    if (fs.existsSync(DATA_DST)) {
        fs.rmSync(DATA_DST, { recursive: true, force: true });
    }

    let total = 0;

    // 1. 中文 help JSON
    total += copyDir(
        path.join(DATA_SRC, 'cn', 'help'),
        path.join(DATA_DST, 'cn', 'help'),
        f => f.endsWith('.json')
    );

    // 2. 英文 help JSON
    total += copyDir(
        path.join(DATA_SRC, 'en', 'help'),
        path.join(DATA_DST, 'en', 'help'),
        f => f.endsWith('.json')
    );

    console.log(`✅ 已复制 ${total} 个 JSON 文件到 data/`);
    console.log('   扩展打包后将包含内置数据，无需外部 data_base/');
}

main();
