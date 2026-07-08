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
        const preamble = this.generatePreamble(cmds, extensionPath);
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

    /** 按 .f 文件顺序运行整个项目（所有文件拼接为一个脚本，保证 proc 跨文件可用） */
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
        const fileContents: Array<{ path: string; content: string }> = [];
        for (const u of cr.units) {
            try {
                const c = fs.readFileSync(u.filePath, 'utf-8');
                fileContents.push({ path: u.relativePath, content: c });
                for (const cmd of this.detectInnovusCommands(c, extensionPath)) { allCmds.add(cmd.command); }
            } catch {
                fileContents.push({ path: u.relativePath, content: '' });
            }
        }

        const db = getDB(extensionPath);
        const cmdList: CmdInfo[] = [];
        for (const n of allCmds) { const info = db.get(n); if (info) { cmdList.push(info); } }
        const preamble = this.generatePreamble(cmdList, extensionPath);

        // 拼接所有文件为一个脚本（用分隔注释标识文件边界）
        let combinedScript = preamble + '\n';
        for (const fc of fileContents) {
            if (!fc.content) continue;
            combinedScript += `\n# ===== FILE: ${fc.path} =====\n`;
            combinedScript += fc.content + '\n';
        }

        const results: ProjectRunResult['results'] = [];
        let errors = 0;
        let execResult: { success: boolean; stdout: string; stderr: string; exitCode: number } | null = null;

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovus-proj-'));
        const tmpFile = path.join(tmpDir, 'combined.tcl');
        try {
            fs.writeFileSync(tmpFile, combinedScript, 'utf-8');
            const workDir = cr.units.length > 0
                ? path.dirname(cr.units[0].filePath)
                : workspaceRoot;
            execResult = await this.executeTclsh(tclsh, tmpFile, workDir);

            // 为每个文件创建结果条目
            for (const fc of fileContents) {
                const fcmds = this.detectInnovusCommands(fc.content || '', extensionPath).map(c => c.command);
                // stdout 有输出 = 脚本至少部分执行成功
                const hasOutput = (execResult?.stdout?.length || 0) > 0;
                const fileSuccess = hasOutput || (execResult?.success ?? false);
                const item: ProjectRunResult['results'][0] = {
                    filePath: fc.path,
                    success: fileSuccess,
                    stdout: execResult?.stdout || '',
                    stderr: execResult?.stderr || '',
                    innovusCommands: fcmds,
                    duration: 0
                };
                if (!fileSuccess) { errors++; }
                results.push(item);
            }
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }

        return { success: errors === 0 && (execResult?.success ?? false), results, totalDuration: Date.now() - t0, fileCount: cr.units.length, errorCount: errors };
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
     * 加载 AI 预生成的仿真数据（含括号匹配验证）。
     */
    private loadSimulation(cmdName: string, extensionPath: string): string | null {
        const languages = ['cn', 'en'];
        for (const lang of languages) {
            const simFile = path.join(extensionPath, 'data', 'simulations', lang, `${cmdName}.json`);
            if (fs.existsSync(simFile)) {
                try {
                    const data = JSON.parse(fs.readFileSync(simFile, 'utf-8'));
                    if (data.tcl && data.tcl.includes('proc ')) {
                        // 验证括号匹配
                        const openB = (data.tcl.match(/\{/g) || []).length;
                        const closeB = (data.tcl.match(/\}/g) || []).length;
                        if (openB === closeB) {
                            return data.tcl;
                        }
                        console.log(`[TCL Runner] 跳过 ${cmdName}: 括号不匹配 {${openB}/}${closeB}`);
                    }
                } catch { /* ignore */ }
            }
        }
        return null;
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
