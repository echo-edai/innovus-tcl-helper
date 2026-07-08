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
        configTclshPath?: string, outputConfig?: RunOutputConfig
    ): Promise<RunResult> {
        const t0 = Date.now();
        const tclsh = this.findTclsh(extensionPath, configTclshPath);
        if (!tclsh) {
            return { success: false, stdout: '', stderr: '未找到 tclsh', exitCode: -1, innovusCommands: [], duration: 0 };
        }

        const cmds = this.detectInnovusCommands(content, extensionPath);
        const preamble = this.generatePreamble(cmds);
        const script = preamble + '\n' + content;

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
                    outputConfig.dir, `run_${Date.now()}`,
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

    /** 按 .f 文件顺序运行整个项目 */
    async runProject(
        fFilePath: string, workspaceRoot: string, extensionPath: string,
        configTclshPath?: string, outputConfig?: RunOutputConfig
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
        for (const u of cr.units) {
            try {
                const c = fs.readFileSync(u.filePath, 'utf-8');
                for (const cmd of this.detectInnovusCommands(c, extensionPath)) { allCmds.add(cmd.command); }
            } catch { /* skip */ }
        }
        const db = getDB(extensionPath);
        const cmdList: CmdInfo[] = [];
        for (const n of allCmds) { const info = db.get(n); if (info) { cmdList.push(info); } }
        const preamble = this.generatePreamble(cmdList);

        const results: ProjectRunResult['results'] = [];
        let errors = 0;

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovus-proj-'));
        try {
            for (const u of cr.units) {
                const ft0 = Date.now();
                let fc: string;
                try { fc = fs.readFileSync(u.filePath, 'utf-8'); } catch {
                    results.push({ filePath: u.relativePath, success: false, stdout: '', stderr: '无法读取', innovusCommands: [], duration: 0 });
                    errors++; continue;
                }
                const script = preamble + '\n' + fc;
                const tf = path.join(tmpDir, `${u.order}_${path.basename(u.filePath)}`);
                fs.writeFileSync(tf, script, 'utf-8');
                const r = await this.executeTclsh(tclsh, tf, path.dirname(u.filePath));
                const fcmds = this.detectInnovusCommands(fc, extensionPath).map(c => c.command);
                const item: ProjectRunResult['results'][0] = {
                    filePath: u.relativePath,
                    success: r.success, stdout: r.stdout, stderr: r.stderr,
                    innovusCommands: fcmds, duration: Date.now() - ft0
                };
                // 保存输出到文件
                if (outputConfig?.enabled && outputConfig.dir) {
                    const safeName = path.basename(u.filePath).replace(/\.tcl$/i, '');
                    item.outputFile = this.saveOutputFile(
                        outputConfig.dir, `${u.order}_${safeName}`,
                        r.stdout, r.stderr, fcmds
                    );
                }
                results.push(item);
                if (!r.success) { errors++; }
            }
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }

        return { success: errors === 0, results, totalDuration: Date.now() - t0, fileCount: cr.units.length, errorCount: errors };
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

    private generatePreamble(cmds: CmdInfo[]): string {
        if (cmds.length === 0) { return ''; }
        let p = '# ===== Innovus Command Wrappers (Auto-generated) =====\n\n';
        for (const cmd of cmds) {
            const n = cmd.command;
            const s = cmd.summary || '';
            p += `# ${s}\nproc ${n} {args} {\n`;
            p += `    puts "\\n═══════════════════════════════════════"\n`;
            p += `    puts "\\[Innovus\\] ${n}"\n`;
            p += `    puts "═══════════════════════════════════════"\n`;
            p += `    puts "  ${s}"\n    puts ""\n`;
            p += `    puts "  调用参数: $args"\n`;
            if (cmd.options && cmd.options.length > 0) {
                const req = cmd.options.filter(o => o.required);
                const opt = cmd.options.filter(o => !o.required);
                if (req.length > 0) {
                    p += `    puts "  必选参数:"\n`;
                    for (const o of req) {
                        p += `    puts "    ${o.name}  ${o.description.replace(/"/g, '\\"')}"\n`;
                    }
                }
                if (opt.length > 0) {
                    p += `    puts "  可选参数 (${opt.length}个):"\n`;
                    for (const o of opt.slice(0, 10)) {
                        const desc = (o.description || '').replace(/"/g, '\\"');
                        p += `    puts "    ${o.name}  ${desc}"\n`;
                    }
                    if (opt.length > 10) {
                        p += `    puts "    ... 还有 ${opt.length - 10} 个参数"\n`;
                    }
                }
            }
            p += `    puts ""\n    return ""\n}\n\n`;
        }
        return p;
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
