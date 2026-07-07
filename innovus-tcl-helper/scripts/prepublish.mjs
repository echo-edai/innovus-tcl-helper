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
    // copyFileSync 自动覆盖，无需先删除

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

    // 3. 确保版本目录存在
    //    test 版本：空目录（关闭所有 Innovus 提示/高亮）
    //    25.1 版本：指向默认 help/ 目录（由 getDataSourceDir 代码逻辑处理）
    ensureDir(path.join(DATA_DST, 'cn', 'vtest', 'help'));
    ensureDir(path.join(DATA_DST, 'cn', 'v25.1', 'help'));
    console.log('   ✅ 已创建版本目录: vtest/help, v25.1/help');

    // 清理 macOS 自动生成的 .DS_Store 文件
    cleanDsStore(DATA_DST);
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function cleanDsStore(dir) {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, file);
        if (file === '.DS_Store') {
            fs.unlinkSync(fullPath);
            console.log(`  🧹 已清理: ${path.relative(ROOT, fullPath)}`);
        } else if (fs.statSync(fullPath).isDirectory()) {
            cleanDsStore(fullPath);
        }
    }
}

main();
