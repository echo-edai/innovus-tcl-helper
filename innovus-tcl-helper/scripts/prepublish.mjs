#!/usr/bin/env node
/**
 * 打包前预处理：构建 DB 文件 + 确保目录结构
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
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

    console.log('✅ data/ 目录结构就绪\n');

    // 构建 help 数据库
    console.log('📦 构建 Help 数据库 ...');
    try {
        execSync('node scripts/build-help-db.mjs', { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
        console.log('  ⚠ Help 数据库构建失败:', e.message);
    }

    // 构建仿真数据库
    console.log('📦 构建仿真数据库 ...');
    try {
        execSync('node scripts/build-sim-db.mjs', { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
        console.log('  ⚠ 仿真数据库构建失败:', e.message);
    }
}

main();
