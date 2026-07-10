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
    ensureDir(path.join(ROOT, 'data', 'tcl-builtins', 'zh'));
    ensureDir(path.join(ROOT, 'data', 'tcl-builtins', 'en'));
    ensureDir(path.join(ROOT, 'data', 'simulations', 'cn'));
    ensureDir(path.join(ROOT, 'data', 'simulations', 'en'));

    console.log('✅ data/ 目录结构就绪');

    // 构建仿真数据库（合并小文件为单文件，减少发布体积）
    console.log('');
    console.log('📦 构建仿真数据库 ...');
    try {
        const { execSync } = await import('child_process');
        execSync('node scripts/build-sim-db.mjs', { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
        console.log('  ⚠ 仿真数据库构建失败（发布可继续）:', e.message);
    }
}

main();
