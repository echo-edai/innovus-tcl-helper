/**
 * TCL Script Runner — 基于 tclsh 的 TCL 代码执行引擎
 *
 * 核心功能:
 *   1. 通过 tclsh 执行标准 TCL 代码（内置 tclsh9.0，无需用户安装）
 *   2. 自动拦截 Innovus 专有命令，输出文档说明代替执行
 *   3. 支持单文件运行 + .f 文件项目运行
 *   4. 支持自定义 tclsh 路径（innovus-tcl.tclshPath）
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDB, CmdInfo } from './commands';
import { tokenize, TokenType } from './tcl-ast';
import { TclCompiler } from './compiler';

// ════════════════════════════════════════════════════════════
//  类型
// ════════════════════════════════════════════════════════════

export interface RunResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    innovusCommands: string[];
    duration: number;
    /** 输出文件路径（如果配置了保存） */
    outputFile?: string;
}

export interface ProjectRunResult {
    success: boolean;
    results: Array<{
        filePath: string;
        success: boolean;
        stdout: string;
        stderr: string;
        innovusCommands: string[];
        duration: number;
        outputFile?: string;
    }>;
    totalDuration: number;
    fileCount: number;
    errorCount: number;
}

/** 运行输出保存配置 */
export interface RunOutputConfig {
    /** 是否保存输出到文件 */
    enabled: boolean;
    /** 输出目录（绝对路径，不存在则自动创建） */
    dir: string;
}

// ════════════════════════════════════════════════════════════
//  常量
// ════════════════════════════════════════════════════════════

const RUN_TIMEOUT = 30000;

// ════════════════════════════════════════════════════════════
//  平台检测
// ════════════════════════════════════════════════════════════

/** 获取当前平台 triplet，如 darwin-arm64, linux-x64, win32-x64 */
function getPlatformTriplet(): string {
    const plat = os.platform();    // 'darwin' | 'linux' | 'win32'
    const arch = os.arch();        // 'arm64' | 'x64' | 'ia32'
    // 标准化: macOS 统一用 darwin
    return `${plat}-${arch}`;
}

/** 各平台 tclsh 二进制名称 */
function getTclshBinaryName(): string {
    return os.platform() === 'win32' ? 'tclsh9.0.exe' : 'tclsh9.0';
}

/** 各平台系统 tclsh 候选路径 */
const SYSTEM_TCLSH_CANDIDATES: Record<string, string[]> = {
    'darwin-arm64': ['/opt/homebrew/bin/tclsh9.0', '/usr/local/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh', 'tclsh9.0'],
    'darwin-x64': ['/usr/local/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh', 'tclsh9.0'],
    'linux-x64': ['/usr/bin/tclsh9.0', '/usr/bin/tclsh', '/usr/local/bin/tclsh9.0', 'tclsh', 'tclsh9.0'],
    'linux-arm64': ['/usr/bin/tclsh9.0', '/usr/bin/tclsh', 'tclsh', 'tclsh9.0'],
    'win32-x64': ['tclsh9.0.exe', 'tclsh.exe'],
    'win32-ia32': ['tclsh9.0.exe', 'tclsh.exe'],
};

export class TclRunner {
    private tclshPathCache: string | null = null;

    /** 查找 tclsh: 内置(平台子目录) > 用户配置 > 系统搜索 */
    findTclsh(extensionPath: string, configTclshPath?: string): string | null {
        if (this.tclshPathCache && fs.existsSync(this.tclshPathCache)) {
            return this.tclshPathCache;
        }
        this.tclshPathCache = null;

        const triplet = getPlatformTriplet();
        const binName = getTclshBinaryName();

        // 1. 扩展内置 tclsh9.0 (bin/<platform>/tclsh9.0)
        const bundled = path.join(extensionPath, 'bin', triplet, binName);
        if (fs.existsSync(bundled)) {
            const v = this.verifyTclsh(bundled);
            if (v) { this.tclshPathCache = v; return v; }
        }

        // 2. 用户配置
        if (configTclshPath && fs.existsSync(configTclshPath)) {
            const v = this.verifyTclsh(configTclshPath);
            if (v) { this.tclshPathCache = v; return v; }
        }

        // 3. 系统搜索（按平台候选路径）
        const candidates = SYSTEM_TCLSH_CANDIDATES[triplet] ||
            ['tclsh', 'tclsh9.0', 'tclsh9.0.exe'];
        for (const c of candidates) {
            const v = this.verifyTclsh(c);
            if (v) { this.tclshPathCache = v; return v; }
        }

        return null;
    }

    private verifyTclsh(p: string): string | null {
        try {
            const r = cp.spawnSync(p, [], {
                input: 'puts [info patchlevel]', timeout: 3000, stdio: 'pipe'
            });
            const ver = r.stdout.toString().trim();
            if (ver && /^\d+\.\d+/.test(ver)) { return p; }
        } catch { /* ignore */ }
        return null;
    }

    /** 运行单个 TCL 脚本 */
    async runScript(
        content: string, workDir: string, extensionPath: string,
        configTclshPath?: string, outputConfig?: RunOutputConfig,
        simOutputMode: 'dry-run' | 'mkdir' = 'dry-run'
    ): Promise<RunResult> {
        const t0 = Date.now();
        const tclsh = this.findTclsh(extensionPath, configTclshPath);
        if (!tclsh) {
            return { success: false, stdout: '', stderr: '未找到 tclsh', exitCode: -1, innovusCommands: [], duration: 0 };
        }

        const cmds = this.detectInnovusCommands(content, extensionPath);
        const preamble = this.generatePreamble(cmds, extensionPath);
        const script = preamble + '\n' + this.buildCompatLayer(simOutputMode) + '\n' + content;

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovus-run-'));
        const tmpFile = path.join(tmpDir, 'run.tcl');
        try {
            fs.writeFileSync(tmpFile, script, 'utf-8');
            const r = await this.executeTclsh(tclsh, tmpFile, workDir);
            const result: RunResult = {
                ...r, innovusCommands: cmds.map(c => c.command), duration: Date.now() - t0
            };

            // 保存输出到文件
            if (outputConfig?.enabled && outputConfig.dir) {
                result.outputFile = this.saveOutputFile(
                    outputConfig.dir, 'run',
                    r.stdout, r.stderr, result.innovusCommands
                );
            }

            return result;
        } catch (e: any) {
            return { success: false, stdout: '', stderr: `异常: ${e.message}`, exitCode: -1, innovusCommands: cmds.map(c => c.command), duration: Date.now() - t0 };
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }

    /** 按 .f 文件顺序运行整个项目（source + catch 保证：遇错即停，逐文件追踪状态） */
    async runProject(
        fFilePath: string, workspaceRoot: string, extensionPath: string,
        configTclshPath?: string, outputConfig?: RunOutputConfig,
        simOutputMode: 'dry-run' | 'mkdir' = 'dry-run'
    ): Promise<ProjectRunResult> {
        const t0 = Date.now();
        const tclsh = this.findTclsh(extensionPath, configTclshPath);
        if (!tclsh) {
            return { success: false, results: [], totalDuration: Date.now() - t0, fileCount: 0, errorCount: 1 };
        }

        const compiler = new TclCompiler();
        const fRel = path.relative(workspaceRoot, fFilePath);
        const cr = compiler.compile(workspaceRoot, fRel);
        if (cr.units.length === 0) {
            return { success: false, results: [], totalDuration: Date.now() - t0, fileCount: 0, errorCount: 1 };
        }

        // 预扫描所有 Innovus 命令
        const allCmds = new Set<string>();
        const fileMetas: Array<{ relPath: string; absPath: string; cmds: string[] }> = [];
        for (const u of cr.units) {
            try {
                const c = fs.readFileSync(u.filePath, 'utf-8');
                const fcmds = this.detectInnovusCommands(c, extensionPath).map(cmd => cmd.command);
                fileMetas.push({ relPath: u.relativePath, absPath: u.filePath, cmds: fcmds });
                for (const cmd of fcmds) { allCmds.add(cmd); }
            } catch {
                fileMetas.push({ relPath: u.relativePath, absPath: u.filePath, cmds: [] });
            }
        }

        const db = getDB(extensionPath);
        const cmdList: CmdInfo[] = [];
        for (const n of allCmds) { const info = db.get(n); if (info) { cmdList.push(info); } }
        const preamble = this.generatePreamble(cmdList, extensionPath);

        // 构建脚本：每个文件用 catch {source} 包装，遇错即停
        let combinedScript = preamble + '\n' + this.buildCompatLayer(simOutputMode);
        combinedScript += '\n# ===== 顺序执行 TCL 文件 =====\n';
        combinedScript += 'set _project_ok 1\n';
        for (const fm of fileMetas) {
            const escapedPath = fm.absPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            combinedScript += `\nputs "_FILE_BEGIN_ ${fm.relPath}"\n`;
            combinedScript += `if {[catch {source "${escapedPath}"} _err]} {\n`;
            combinedScript += `    puts "_FILE_ERROR_ ${fm.relPath}"\n`;
            combinedScript += `    puts "_ERROR_MSG_ $_err"\n`;
            combinedScript += `    puts "_ERROR_INFO_ $::errorInfo"\n`;
            combinedScript += `    set _project_ok 0\n`;
            combinedScript += `    exit 1\n`;
            combinedScript += `}\n`;
            combinedScript += `puts "_FILE_END_ ${fm.relPath}"\n`;
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovus-proj-'));
        const tmpFile = path.join(tmpDir, 'combined.tcl');
        try {
            fs.writeFileSync(tmpFile, combinedScript, 'utf-8');
            const workDir = fileMetas.length > 0
                ? path.dirname(fileMetas[0].absPath)
                : workspaceRoot;
            const execResult = await this.executeTclsh(tclsh, tmpFile, workDir);

            // 解析标记，逐文件判定状态
            const results: ProjectRunResult['results'] = [];
            const allOutput = execResult.stdout;
            let errors = 0;
            for (const fm of fileMetas) {
                const okMarker = `_FILE_END_ ${fm.relPath}`;
                const errMarker = `_FILE_ERROR_ ${fm.relPath}`;
                if (allOutput.includes(okMarker)) {
                    results.push({ filePath: fm.relPath, success: true, stdout: allOutput, stderr: '', innovusCommands: fm.cmds, duration: 0 });
                } else if (allOutput.includes(errMarker)) {
                    // 合并 stdout + stderr 构建完整错误信息
                    const errIdx = allOutput.indexOf(errMarker);
                    const errInfoIdx = allOutput.indexOf('_ERROR_INFO_', errIdx);
                    const errMsgIdx = allOutput.indexOf('_ERROR_MSG_', errIdx);
                    const parts: string[] = [];

                    // 1. 简短错误消息
                    if (errMsgIdx >= 0) {
                        const msgEnd = allOutput.indexOf('\n', errMsgIdx);
                        const msg = allOutput.substring(errMsgIdx + '_ERROR_MSG_ '.length, msgEnd >= 0 ? msgEnd : allOutput.length).trim();
                        if (msg) { parts.push(`错误: ${msg}`); }
                    }

                    // 2. 堆栈跟踪（含 proc 名、行号）
                    if (errInfoIdx >= 0) {
                        const infoStart = errInfoIdx + '_ERROR_INFO_ '.length;
                        const nextMarker = allOutput.indexOf('_FILE_', infoStart);
                        const infoEnd = nextMarker >= 0 ? nextMarker : allOutput.length;
                        const info = allOutput.substring(infoStart, infoEnd).trim();
                        if (info) { parts.push(info); }
                    }

                    // 3. stderr（tclsh 编译错误在此）
                    const stderrText = execResult.stderr.trim();
                    if (stderrText && !parts.some(p => p.includes(stderrText.substring(0, 30)))) {
                        parts.push(`[stderr] ${stderrText}`);
                    }

                    // 4. 出问题文件
                    parts.push(`文件: ${fm.relPath}`);
                    parts.push(`路径: ${fm.absPath}`);

                    const errMsg = parts.join('\n');
                    results.push({ filePath: fm.relPath, success: false, stdout: allOutput, stderr: errMsg, innovusCommands: fm.cmds, duration: 0 });
                    errors++;
                    break;
                } else {
                    // 未被执行到（前面的文件出错了）
                    results.push({ filePath: fm.relPath, success: false, stdout: '', stderr: '前置文件执行失败，未运行到此文件', innovusCommands: fm.cmds, duration: 0 });
                    errors++;
                }
            }

            // 如果有文件成功执行但没错误，补上剩余的未执行文件
            for (let i = results.length; i < fileMetas.length; i++) {
                const fm = fileMetas[i];
                results.push({ filePath: fm.relPath, success: false, stdout: '', stderr: '前置文件执行失败，未运行到此文件', innovusCommands: fm.cmds, duration: 0 });
                errors++;
            }

            // 保存输出到文件
            let outputFile: string | undefined;
            if (outputConfig?.enabled && outputConfig.dir) {
                outputFile = this.saveOutputFile(
                    outputConfig.dir, 'project_run',
                    execResult.stdout, execResult.stderr,
                    [...allCmds]
                );
            }

            return {
                success: errors === 0, results,
                totalDuration: Date.now() - t0, fileCount: fileMetas.length,
                errorCount: errors
            };
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }

    private detectInnovusCommands(content: string, extensionPath: string): CmdInfo[] {
        const db = getDB(extensionPath);
        const tokens = tokenize(content);
        const found = new Set<string>();
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === TokenType.COMMAND) {
                const info = db.get(tokens[i].value);
                if (info) { found.add(tokens[i].value); }
            }
        }
        const r: CmdInfo[] = [];
        for (const n of found) { const info = db.get(n); if (info) { r.push(info); } }
        return r;
    }

    /**
     * 保存运行输出到文件。
     * @returns 输出文件的绝对路径
     */
    private saveOutputFile(
        outDir: string, baseName: string,
        stdout: string, stderr: string, innovusCmds: string[]
    ): string {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${baseName}_${ts}.log`;
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const filePath = path.join(outDir, filename);
        let content = '';
        content += `# Innovus TCL Run Log\n`;
        content += `# Time: ${new Date().toISOString()}\n`;
        content += `# Innovus Commands: ${innovusCmds.join(', ') || '(none)'}\n`;
        content += `# ========================================\n\n`;
        if (stdout.trim()) {
            content += `── STDOUT ──\n${stdout}\n`;
        }
        if (stderr.trim()) {
            content += `── STDERR ──\n${stderr}\n`;
        }
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[TCL Runner] 输出已保存: ${filePath}`);
        return filePath;
    }

    /** TCL 内置命令集合 — 不能被 proc 包装覆盖，否则会破坏执行流 */
    private static readonly TCL_BUILTINS = new Set([
        'source',   // TCL 原生文件加载，被覆盖会导致 .tcl 文件无法加载
    ]);

    /**
     * 生成 Innovus 命令 proc 包装器。
     * 优先使用 AI 生成的仿真数据，否则显示命令文档。
     */
    private generatePreamble(cmds: CmdInfo[], extensionPath: string): string {
        if (cmds.length === 0) { return ''; }

        let preamble = '';
        preamble += '# ===== Innovus Command Wrappers (Auto-generated) =====\n\n';

        for (const cmd of cmds) {
            const cmdName = cmd.command;

            // 跳过 TCL 内置命令，保持原生行为
            if (TclRunner.TCL_BUILTINS.has(cmdName)) {
                continue;
            }

            // 1. 尝试加载 AI 仿真数据
            const simCode = this.loadSimulation(cmdName, extensionPath);
            if (simCode) {
                preamble += simCode + '\n';
                continue;
            }

            // 2. 无仿真数据：生成文档输出包装器
            const summary = cmd.summary || '';
            preamble += `# ${summary}\n`;
            preamble += `proc ${cmdName} {args} {\n`;
            preamble += `    puts "\\n═══════════════════════════════════════"\n`;
            preamble += `    puts "\\[Innovus\\] ${cmdName}"\n`;
            preamble += `    puts "═══════════════════════════════════════"\n`;
            preamble += `    puts "  ${summary}"\n    puts ""\n`;
            preamble += `    puts "  调用参数: $args"\n`;

            if (cmd.options && cmd.options.length > 0) {
                const req = cmd.options.filter(o => o.required);
                const opt = cmd.options.filter(o => !o.required);
                if (req.length > 0) {
                    preamble += `    puts "  必选参数:"\n`;
                    for (const o of req) {
                        preamble += `    puts "    ${o.name}  ${o.description.replace(/"/g, '\\"')}"\n`;
                    }
                }
                if (opt.length > 0) {
                    preamble += `    puts "  可选参数 (${opt.length}个):"\n`;
                    for (const o of opt.slice(0, 10)) {
                        const desc = (o.description || '').replace(/"/g, '\\"');
                        preamble += `    puts "    ${o.name}  ${desc}"\n`;
                    }
                    if (opt.length > 10) {
                        preamble += `    puts "    ... 还有 ${opt.length - 10} 个参数"\n`;
                    }
                }
            }
            preamble += `    puts ""\n    return ""\n}\n\n`;
        }

        return preamble;
    }

    /**
     * 加载 AI 预生成的仿真数据（纯 .tcl 文件，含括号匹配验证）。
     * cn 优先：中文仿真数据覆盖更全。
     */
    private loadSimulation(cmdName: string, extensionPath: string): string | null {
        const languages = ['cn', 'en'];
        for (const lang of languages) {
            const simFile = path.join(extensionPath, 'data', 'simulations', lang, `${cmdName}.tcl`);
            if (fs.existsSync(simFile)) {
                try {
                    const tcl = fs.readFileSync(simFile, 'utf-8').trim();
                    if (tcl.includes('proc ')) {
                        const openB = (tcl.match(/\{/g) || []).length;
                        const closeB = (tcl.match(/\}/g) || []).length;
                        if (openB === closeB) {
                            return tcl;
                        }
                        console.log(`[TCL Runner] 跳过 ${cmdName}: 括号不匹配 {${openB}/}${closeB}`);
                    }
                } catch { /* ignore */ }
            }
        }
        return null;
    }

    /**
     * 构建 TCL 兼容层：echo + 文件辅助 proc + 增强 unknown handler
     */
    private buildCompatLayer(simOutputMode: 'dry-run' | 'mkdir'): string {
        let code = '\n# ===== TCL 兼容层 =====\n';
        code += 'if {[info commands echo] eq ""} { proc echo {args} { puts [join $args " "] } }\n';

        // 文件操作辅助
        code += '\n# ===== 文件操作辅助 =====\n';
        code += `set ::_sim_file_mode "${simOutputMode}"\n`;
        code += 'proc _check_input_file {filepath} {\n';
        code += '    if {[file exists $filepath]} {\n';
        code += '        puts "   📂 输入文件: $filepath"\n';
        code += '    } else {\n';
        code += '        puts "   ⚠ 输入文件不存在: $filepath"\n';
        code += '    }\n';
        code += '}\n';
        code += 'proc _handle_output_file {filepath} {\n';
        code += '    if {$::_sim_file_mode eq "mkdir"} {\n';
        code += '        set dir [file dirname $filepath]\n';
        code += '        if {![file exists $dir]} {\n';
        code += '            file mkdir $dir\n';
        code += '            puts "   📁 创建目录: $dir"\n';
        code += '        }\n';
        code += '        if {![file exists $filepath]} {\n';
        code += '            set f [open $filepath w]\n';
        code += '            puts $f "# Innovus TCL Simulator Output"\n';
        code += '            close $f\n';
        code += '        }\n';
        code += '        puts "   📄 生成文件: $filepath"\n';
        code += '    } else {\n';
        code += '        puts "   📄 \\[dry-run\\] 将生成文件: $filepath"\n';
        code += '    }\n';
        code += '}\n';

        // 未知命令处理 + -file 参数检测
        code += '\n# 兜底：未注册命令 + 文件检测\n';
        code += 'rename unknown _tcl_unknown\n';
        // TCL 内置命令集合（用于 unknown 检测）
        code += 'set ::_tcl_builtins {set puts proc if while for foreach switch return break continue catch error eval expr source incr append lappend llength lindex lrange lsort split join regexp regsub string scan format open close gets read file glob cd pwd exit rename info array dict upvar uplevel namespace variable global after vwait update clock encoding fconfigure socket package require apply coroutine tailcall try throw}\n';
        code += 'proc unknown {args} {\n';
        code += '    set _cmd [lindex $args 0]\n';
        code += '    set _is_tcl [lsearch -exact $::_tcl_builtins $_cmd]\n';
        code += '    if {$_is_tcl >= 0} {\n';
        code += '        # TCL 内置命令，执行原生行为\n';
        code += '        return [uplevel ::_tcl_unknown {*}$args]\n';
        code += '    }\n';
        code += '    puts "\\[⚠ Unknown\\] $_cmd: [lrange $args 1 end]"\n';
        code += '    set _rest [lrange $args 1 end]\n';
        code += '    # 判断命令类型：输入命令 vs 输出命令\n';
        code += '    set _is_input [regexp {^(read_|load_|source$|defIn$|init_)} $_cmd]\n';
        code += '    set _is_output [regexp {^(report_|write_|save_|defOut$)} $_cmd]\n';
        code += '    for {set _i 0} {$_i < [llength $_rest]} {incr _i} {\n';
        code += '        set _arg [lindex $_rest $_i]\n';
        code += '        if {$_arg eq "-file" || $_arg eq "-outDir"} {\n';
        code += '            incr _i\n';
        code += '            if {$_i < [llength $_rest]} {\n';
        code += '                set _fp [lindex $_rest $_i]\n';
        code += '                if {$_is_input} {\n';
        code += '                    _check_input_file $_fp\n';
        code += '                } else {\n';
        code += '                    _handle_output_file $_fp\n';
        code += '                }\n';
        code += '            }\n';
        code += '        }\n';
        code += '    }\n';
        code += '    return ""\n';
        code += '}\n';

        return code;
    }

    private executeTclsh(
        tclshPath: string, scriptFile: string, workDir: string
    ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
        return new Promise((resolve) => {
            const proc = cp.spawn(tclshPath, [scriptFile], {
                cwd: workDir, timeout: RUN_TIMEOUT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env }
            });
            let stdout = '', stderr = '';
            let settled = false;
            const done = (ok: boolean, code: number) => {
                if (settled) { return; }
                settled = true;
                resolve({ success: ok, stdout, stderr, exitCode: code });
            };
            proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
            proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
            proc.on('close', (code: number | null) => { done(code === 0 && !stderr.trim(), code ?? -1); });
            proc.on('error', (e: Error) => { stderr += `进程错误: ${e.message}`; done(false, -1); });
            setTimeout(() => { if (!settled) { proc.kill(); stderr += '\n⏱ 超时'; done(false, -1); } }, RUN_TIMEOUT);
        });
    }
}

// ════════════════════════════════════════════════════════════
//  单例
// ════════════════════════════════════════════════════════════

let runnerInstance: TclRunner | null = null;

export function getRunner(): TclRunner {
    if (!runnerInstance) { runnerInstance = new TclRunner(); }
    return runnerInstance;
}
