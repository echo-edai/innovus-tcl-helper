/**
 * TCL Script Runner — 基于 tclsh 的 TCL 代码执行引擎
 *
 * 核心功能:
 *   1. 通过 tclsh 执行标准 TCL 代码
 *   2. 自动拦截 Innovus 专有命令，输出文档说明代替执行
 *   3. 支持脚本级和片段级执行
 *   4. 输出 stdout / stderr 分离
 *
 * 执行流程:
 *   源码 → 分词识别 Innovus 命令 → 注入 proc 包装器 → tclsh 执行 → 捕获输出
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDB, CmdInfo } from './commands';
import { tokenize, TokenType } from './tcl-ast';

// ════════════════════════════════════════════════════════════
//  类型定义
// ════════════════════════════════════════════════════════════

/** 单次运行结果 */
export interface RunResult {
    success: boolean;           // tclsh 是否成功执行
    stdout: string;             // 标准输出
    stderr: string;             // 标准错误
    exitCode: number;
    innovusCommands: string[];  // 被拦截的 Innovus 命令列表
    duration: number;           // 执行耗时 (ms)
}

// ════════════════════════════════════════════════════════════
//  配置
// ════════════════════════════════════════════════════════════

/** tclsh 可执行文件优先级 */
const TCLSH_CANDIDATES = [
    '/opt/homebrew/bin/tclsh9.0',
    '/usr/local/bin/tclsh9.0',
    '/usr/bin/tclsh',
    'tclsh',
    'tclsh9.0',
];

/** 执行超时 (ms) */
const RUN_TIMEOUT = 30000;

// ════════════════════════════════════════════════════════════
//  TCL Runner
// ════════════════════════════════════════════════════════════

export class TclRunner {
    private tclshPath: string | null = null;
    private initialized: boolean = false;

    /**
     * 查找系统中可用的 tclsh。
     */
    findTclsh(): string | null {
        if (this.tclshPath) { return this.tclshPath; }

        for (const candidate of TCLSH_CANDIDATES) {
            try {
                const result = cp.spawnSync(candidate, ['-h'], {
                    timeout: 3000,
                    stdio: 'pipe'
                });
                if (result.status !== null || result.error === undefined) {
                    // 进一步验证：执行版本检查
                    const verResult = cp.spawnSync(candidate, [], {
                        input: 'puts [info patchlevel]',
                        timeout: 3000,
                        stdio: 'pipe'
                    });
                    const version = verResult.stdout.toString().trim();
                    if (version && /^\d+\.\d+/.test(version)) {
                        this.tclshPath = candidate;
                        console.log(`[TCL Runner] 找到 tclsh: ${candidate} (v${version})`);
                        return candidate;
                    }
                }
            } catch {
                // 继续尝试下一个
            }
        }
        console.log('[TCL Runner] 未找到 tclsh，请安装: brew install tcl-tk');
        return null;
    }

    /**
     * 运行 TCL 脚本内容。
     * @param content - TCL 脚本源代码
     * @param workDir - 工作目录（用于 source 命令的相对路径解析）
     * @param extensionPath - 扩展安装路径（用于读取 Innovus 命令文档）
     * @returns 运行结果
     */
    async runScript(
        content: string,
        workDir: string,
        extensionPath: string
    ): Promise<RunResult> {
        const startTime = Date.now();

        // 查找 tclsh
        const tclsh = this.findTclsh();
        if (!tclsh) {
            return {
                success: false,
                stdout: '',
                stderr: '未找到 tclsh 解释器。请执行: brew install tcl-tk',
                exitCode: -1,
                innovusCommands: [],
                duration: Date.now() - startTime
            };
        }

        // 1. 识别脚本中使用的 Innovus 命令
        const innovusCmds = this.detectInnovusCommands(content, extensionPath);
        const innovusCommandNames = innovusCmds.map(c => c.command);

        // 2. 生成 Innovus 命令的 proc 包装器
        const preamble = this.generatePreamble(innovusCmds, extensionPath);

        // 3. 拼接完整脚本
        const fullScript = preamble + '\n' + content;

        // 4. 写入临时文件并执行
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovus-run-'));
        const tmpFile = path.join(tmpDir, 'run.tcl');

        try {
            fs.writeFileSync(tmpFile, fullScript, 'utf-8');

            // 5. 通过 tclsh 执行
            const result = await this.executeTclsh(tclsh, tmpFile, workDir);

            return {
                ...result,
                innovusCommands: innovusCommandNames,
                duration: Date.now() - startTime
            };
        } catch (e: any) {
            return {
                success: false,
                stdout: '',
                stderr: `执行异常: ${e.message}`,
                exitCode: -1,
                innovusCommands: innovusCommandNames,
                duration: Date.now() - startTime
            };
        } finally {
            // 清理临时文件
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }

    /**
     * 检测 TCL 源码中使用的 Innovus 专有命令。
     */
    private detectInnovusCommands(content: string, extensionPath: string): CmdInfo[] {
        const db = getDB(extensionPath);
        const tokens = tokenize(content);
        const found = new Set<string>();

        // 遍历 token，找到 COMMAND token（命令名）
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === TokenType.COMMAND) {
                const cmdName = tokens[i].value;
                const cmdInfo = db.get(cmdName);
                if (cmdInfo) {
                    found.add(cmdName);
                }
            }
        }

        const results: CmdInfo[] = [];
        for (const name of found) {
            const info = db.get(name);
            if (info) { results.push(info); }
        }
        return results;
    }

    /**
     * 生成 Innovus 命令 proc 包装器前导代码。
     * 为每个 Innovus 命令生成一个 proc，打印命令文档并返回。
     */
    private generatePreamble(innovusCmds: CmdInfo[], extensionPath: string): string {
        if (innovusCmds.length === 0) { return ''; }

        const db = getDB(extensionPath);
        const lang = db.getLanguage();
        const isZh = lang === 'zh';

        let preamble = '';
        preamble += '# ==========================================\n';
        preamble += isZh
            ? '# Innovus 命令文档包装器（自动生成）\n'
            : '# Innovus Command Doc Wrappers (Auto-generated)\n';
        preamble += '# ==========================================\n\n';

        for (const cmd of innovusCmds) {
            const cmdName = cmd.command;
            const summary = cmd.summary || '';
            const usage = cmd.usage || '';

            // 生成 proc 包装器
            preamble += `# ${summary}\n`;
            preamble += `proc ${cmdName} {args} {\n`;

            // 打印命令头（TCL 中需转义 [] 为 \[\]）
            preamble += `    puts "\\n═══════════════════════════════════════"\n`;
            preamble += `    puts "\\[Innovus\\] ${cmdName}"\n`;
            preamble += `    puts "═══════════════════════════════════════"\n`;
            preamble += `    puts "  ${summary}"\n`;
            preamble += `    puts ""\n`;
            preamble += `    puts "  调用参数: $args"\n`;

            // 打印必选参数
            if (cmd.options && cmd.options.length > 0) {
                const required = cmd.options.filter(o => o.required);
                const optional = cmd.options.filter(o => !o.required);
                if (required.length > 0) {
                    preamble += `    puts "  必选参数:"\n`;
                    for (const opt of required) {
                        preamble += `    puts "    ${opt.name}  ${opt.description.replace(/"/g, '\\"')}"\n`;
                    }
                }
                // 只打印前 10 个可选参数
                if (optional.length > 0) {
                    preamble += `    puts "  可选参数 (${optional.length}个):"\n`;
                    for (const opt of optional.slice(0, 10)) {
                        const desc = (opt.description || '').replace(/"/g, '\\"');
                        preamble += `    puts "    ${opt.name}  ${desc}"\n`;
                    }
                    if (optional.length > 10) {
                        preamble += `    puts "    ... 还有 ${optional.length - 10} 个参数"\n`;
                    }
                }
            }

            preamble += `    puts ""\n`;
            preamble += `    return ""\n`;
            preamble += `}\n\n`;
        }

        return preamble;
    }

    /**
     * 通过 child_process 执行 tclsh。
     */
    private executeTclsh(
        tclshPath: string,
        scriptFile: string,
        workDir: string
    ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
        return new Promise((resolve) => {
            const proc = cp.spawn(tclshPath, [scriptFile], {
                cwd: workDir,
                timeout: RUN_TIMEOUT,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env }
            });

            let stdout = '';
            let stderr = '';
            let settled = false;

            const finish = (success: boolean, exitCode: number) => {
                if (settled) { return; }
                settled = true;
                resolve({ success, stdout, stderr, exitCode });
            };

            proc.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            proc.on('close', (code: number | null) => {
                const exitCode = code ?? -1;
                if (stderr.trim() && !stdout.trim()) {
                    // TCL 错误可能输出到 stdout
                    finish(false, exitCode);
                } else {
                    finish(exitCode === 0 || stdout.trim().length > 0, exitCode);
                }
            });

            proc.on('error', (err: Error) => {
                stderr += `进程错误: ${err.message}`;
                finish(false, -1);
            });

            // 超时处理
            setTimeout(() => {
                if (!settled) {
                    proc.kill();
                    stderr += '\n⏱ 执行超时 (30s)';
                    finish(false, -1);
                }
            }, RUN_TIMEOUT);
        });
    }
}

// ════════════════════════════════════════════════════════════
//  单例
// ════════════════════════════════════════════════════════════

let runnerInstance: TclRunner | null = null;

export function getRunner(): TclRunner {
    if (!runnerInstance) {
        runnerInstance = new TclRunner();
    }
    return runnerInstance;
}
