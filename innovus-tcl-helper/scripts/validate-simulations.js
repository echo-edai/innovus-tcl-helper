#!/usr/bin/env node
/**
 * TCL 仿真语法检查器 — 用 tclsh 批量检测所有仿真文件的 TCL 代码
 *
 * 用法:
 *   node scripts/validate-simulations.mjs [--lang cn|en] [--fix]
 *   --fix  自动尝试修复常见的 AI 生成语法错误
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const LANG = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'cn';
const FIX = args.includes('--fix');

// 查找 tclsh
function findTclsh() {
    const platform = `${os.platform()}-${os.arch()}`;
    const binName = os.platform() === 'win32' ? 'tclsh9.0.exe' : 'tclsh9.0';
    const bundled = path.join(ROOT, 'bin', platform, binName);
    if (fs.existsSync(bundled)) return bundled;

    const candidates = {
        'darwin-arm64': ['/opt/homebrew/bin/tclsh9.0', '/usr/local/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh'],
        'darwin-x64': ['/usr/local/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh'],
        'linux-x64': ['/usr/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh'],
        'win32-x64': ['tclsh9.0.exe', 'tclsh.exe']
    }[platform] || ['tclsh', 'tclsh9.0'];

    for (const c of candidates) {
        try {
            const r = cp.spawnSync(c, ['-e', 'puts [info patchlevel]'], { timeout: 3000 });
            if (r.stdout.toString().trim().match(/^\d+\.\d+/)) return c;
        } catch (e) { /* ignore */ }
    }
    return null;
}

// 常见的 AI 生成语法错误修复
function fixCommonErrors(tcl) {
    let fixed = tcl;

    // 1. switch 语句中 -word{ 缺空格 → -word {
    fixed = fixed.replace(/(-[a-zA-Z_][a-zA-Z0-9_]*) \{/g, (match, word) => {
        // 在 switch 上下文中，-word { 是正确的，不需修复
        return match;
    });
    fixed = fixed.replace(/(-[a-zA-Z_][a-zA-Z0-9_]*)\{(?!\s)/g, '$1 {');

    // 2. 字符串中未转义的特殊字符（在 [...] 内部的引号问题）
    // 3. if/while/foreach 后面缺空格
    fixed = fixed.replace(/\b(if|while|foreach|switch)\{/g, '$1 {');
    fixed = fixed.replace(/\}(elseif|else)\{/g, '} $1 {');

    // 4. 注释标记后的 proc 误识别
    // (no-op for now)

    return fixed;
}

async function main() {
    const simDir = path.join(ROOT, 'data', 'simulations', LANG);
    const files = fs.readdirSync(simDir).filter(f => f.endsWith('.json')).sort();

    const tclsh = findTclsh();
    if (!tclsh) {
        console.error('❌ 未找到 tclsh');
        process.exit(1);
    }
    console.log(`🔧 tclsh: ${tclsh}`);
    console.log(`📂 目录: ${simDir}`);
    console.log(`📊 共 ${files.length} 个仿真文件`);
    console.log('');

    let ok = 0, err = 0, fixed = 0;
    const errors = [];

    for (const f of files) {
        const cmdName = f.replace('.json', '');
        const filePath = path.join(simDir, f);

        try {
            const d = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            let tcl = d.tcl || '';

            if (!tcl.includes('proc ')) {
                console.log(`⚠ ${cmdName}: 无 proc 定义`);
                continue;
            }

            // 构建测试脚本：定义 proc 然后验证
            const testScript = tcl + `\nputs "OK:${cmdName}"\n`;

            // 写入临时文件（避免 tclsh -e 的多行参数问题）
            const tmpFile = path.join(os.tmpdir(), `tcl_check_${cmdName}.tcl`);
            fs.writeFileSync(tmpFile, testScript, 'utf-8');

            const r = cp.spawnSync(tclsh, [tmpFile], {
                timeout: 5000,
                stdio: 'pipe',
                encoding: 'utf-8'
            });

            // 清理临时文件
            try { fs.unlinkSync(tmpFile); } catch (e) { }

            const stdout = r.stdout || '';
            const stderr = (r.stderr || '').trim();

            if (r.status === 0 && stdout.includes(`OK:${cmdName}`) && !stderr) {
                ok++;
                if (ok % 200 === 0) process.stdout.write(`\r  已检测 ${ok}/${files.length}...`);
            } else {
                // 有错误
                const errMsg = stderr || stdout || `exit code ${r.status}`;
                errors.push({ cmd: cmdName, msg: errMsg, path: filePath });

                if (FIX) {
                    const fixedTcl = fixCommonErrors(tcl);
                    if (fixedTcl !== tcl) {
                        d.tcl = fixedTcl;
                        fs.writeFileSync(filePath, JSON.stringify(d, null, 2), 'utf-8');
                        fixed++;
                        console.log(`\n🔧 ${cmdName}: 已自动修复`);
                        // 重试（临时文件方式）
                        const tmpFile2 = path.join(os.tmpdir(), `tcl_fix_${cmdName}.tcl`);
                        fs.writeFileSync(tmpFile2, fixedTcl + `\nputs "OK:${cmdName}"\n`, 'utf-8');
                        const r2 = cp.spawnSync(tclsh, [tmpFile2], {
                            timeout: 5000, stdio: 'pipe', encoding: 'utf-8'
                        });
                        try { fs.unlinkSync(tmpFile2); } catch (e) { }
                        if (r2.status === 0 && r2.stdout.includes(`OK:${cmdName}`)) {
                            ok++;
                            console.log(`   ✅ 修复后通过`);
                            continue;
                        } else {
                            console.log(`   ❌ 修复后仍失败:`, (r2.stderr || r2.stdout || '').split('\n')[0]);
                        }
                    }
                } else {
                    // 每发现一个错误立即输出
                    console.log(`\n❌ ${cmdName}`);
                    console.log(`   ${errMsg.split('\n').slice(0, 3).join('\n   ')}`);
                }
                err++;
            }
        } catch (e) {
            console.log(`\n💥 ${cmdName}: ${e.message}`);
            errors.push({ cmd: cmdName, msg: e.message, path: filePath });
            err++;
        }
    }

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log(`✅ ${ok} 通过  ❌ ${err} 失败`);
    if (FIX) console.log(`🔧 ${fixed} 已自动修复`);
    console.log(`📂 ${simDir}`);

    // 输出失败列表
    if (errors.length > 0) {
        console.log('');
        console.log('── 失败详情 ──');
        // 按错误类型归类
        const byType = {};
        errors.forEach(e => {
            const type = e.msg.split('\n')[0].substring(0, 60);
            byType[type] = (byType[type] || []).concat(e.cmd);
        });
        for (const [type, cmds] of Object.entries(byType)) {
            console.log(`\n[${cmds.length}个] ${type}`);
            cmds.slice(0, 10).forEach(c => console.log(`  - ${c}`));
            if (cmds.length > 10) console.log(`  ... 还有 ${cmds.length - 10} 个`);
        }
    }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
