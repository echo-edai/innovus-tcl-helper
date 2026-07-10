/**
 * Innovus 命令数据库 - 轻量级命令信息加载与查询
 *
 * 数据目录结构:
 *   data/cmds/innovus/
 *   ├── 25.1/                    ← 默认版本 (Innovus 25.1)
 *   │   ├── cn/help/*.json       ← 中文命令文档
 *   │   └── en/help/*.json       ← 英文命令文档
 *   ├── test/                    ← 测试版本 (空数据/关闭高亮)
 *   │   ├── cn/help/             ← 空目录
 *   │   └── en/help/             ← 空目录
 *   └── {custom}/                ← 自定义工具 (如 dc)
 *       ├── cn/help/*.json
 *       └── en/help/*.json
 *
 * 版本选择:
 *   默认/25.1 → data/cmds/innovus/25.1/{lang}/help/
 *   test      → data/cmds/innovus/test/{lang}/help/
 *   其他      → data/cmds/innovus/{version}/{lang}/help/
 */

import * as fs from 'fs';
import * as path from 'path';

/** 支持的语言 */
export type Language = 'zh' | 'en';

/** 命令选项/参数 */
export interface CmdOption {
    name: string;
    description: string;
    required: boolean;
    type: string;          // "string" | "flag" | "enum" | "point" | "int" | "float"
}

/** 命令信息 */
export interface CmdInfo {
    command: string;
    is_cmd: boolean;
    summary: string;
    description: string;
    usage: string;
    options: CmdOption[];
}

/** 命令数据库 */
class CommandDB {
    private commands: Map<string, CmdInfo> = new Map();
    private loaded: boolean = false;
    private dataRoot: string;        // data/cmds/innovus/ 目录
    private language: Language = 'zh';
    private version: string = '';    // 版本标识，如 "25.1", "test", "dc"

    constructor(extensionPath: string) {
        // 始终使用扩展内置的 data/cmds/innovus/ 目录
        this.dataRoot = path.join(extensionPath, 'data', 'cmds', 'innovus');
    }

    /** 设置语言 */
    setLanguage(lang: Language): void {
        if (this.language !== lang) {
            this.language = lang;
            this.reload();
        }
    }

    /** 获取当前语言 */
    getLanguage(): Language { return this.language; }

    /** 设置版本 */
    setVersion(ver: string): void {
        if (this.version !== ver) {
            this.version = ver;
            this.reload();
        }
    }

    /** 获取当前版本 */
    getVersion(): string { return this.version; }

    /** 扫描 data/innovus/ 下所有可用版本 */
    getAvailableVersions(): { label: string; description: string }[] {
        if (!fs.existsSync(this.dataRoot)) { return []; }

        const versions: { label: string; description: string }[] = [];
        try {
            const entries = fs.readdirSync(this.dataRoot, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) { continue; }
                const verName = entry.name;
                // 检查该版本是否有数据目录
                const cnHelp = path.join(this.dataRoot, verName, 'cn', 'help');
                const enHelp = path.join(this.dataRoot, verName, 'en', 'help');
                if (fs.existsSync(cnHelp) || fs.existsSync(enHelp)) {
                    const fileCount = this.countFiles(cnHelp) + this.countFiles(enHelp);
                    if (verName === '25.1') {
                        versions.push({ label: '25.1', description: `Innovus 25.1 — ${fileCount} 个文件` });
                    } else if (verName === 'test') {
                        versions.push({ label: 'test', description: '测试模式 — 空数据 (关闭 Innovus 高亮/提示)' });
                    } else {
                        versions.push({ label: verName, description: `自定义: ${verName} — ${fileCount} 个文件` });
                    }
                }
            }
        } catch { /* ignore */ }

        // 确保 25.1 排第一
        return versions.sort((a, b) => {
            if (a.label === '25.1') { return -1; }
            if (b.label === '25.1') { return 1; }
            return a.label.localeCompare(b.label);
        });
    }

    private countFiles(dir: string): number {
        if (!fs.existsSync(dir)) { return 0; }
        try {
            return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
        } catch { return 0; }
    }

    /** 获取数据库统计信息 */
    getStats(): { totalEntries: number; commands: number; variables: number; version: string; language: string } {
        this.load();
        let cmdCount = 0;
        let varCount = 0;
        for (const info of this.commands.values()) {
            if (info.is_cmd !== false) { cmdCount++; }
            else { varCount++; }
        }
        return {
            totalEntries: this.commands.size,
            commands: cmdCount,
            variables: varCount,
            version: this.version || '25.1',
            language: this.language
        };
    }

    /** 获取数据文件所在目录
     *  结构: data/cmds/innovus/{version}/{langDir}/help/
     *  langDir: zh → cn, en → en
     */
    private getDataSourceDir(): string {
        const ver = this.version || '25.1';
        const langDir = this.language === 'zh' ? 'cn' : 'en';
        return path.join(this.dataRoot, ver, langDir, 'help');
    }

    /** 加载命令数据 — 优先读 .db.json 单文件 */
    load(): void {
        if (this.loaded) { return; }

        try {
            const dataDir = this.getDataSourceDir();
            const parentDir = path.dirname(dataDir);
            const dbFile = path.join(parentDir, 'help.db.json');

            // 1. 尝试单文件 DB
            if (fs.existsSync(dbFile)) {
                const db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
                const cmds = db.commands || {};
                for (const [name, info] of Object.entries(cmds)) {
                    this.commands.set(name, info as CmdInfo);
                }
                this.loaded = true;
                console.log(`[Innovus TCL] 已加载 ${this.commands.size} 个命令 (版本: ${this.version || '25.1'}, 语言: ${this.language}, DB模式)`);
                return;
            }

            // 2. 回退到独立 .json 文件
            if (!fs.existsSync(dataDir)) {
                console.warn(`[Innovus TCL] 数据目录不存在: ${dataDir}`);
                this.loaded = true;
                return;
            }

            const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const filePath = path.join(dataDir, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const info: CmdInfo = JSON.parse(content);
                    if (info.command) {
                        this.commands.set(info.command, info);
                    }
                } catch {
                    // 跳过解析失败的文件
                }
            }
            this.loaded = true;
            console.log(`[Innovus TCL] 已加载 ${this.commands.size} 个命令 (版本: ${this.version || '25.1'}, 语言: ${this.language})`);
        } catch (err) {
            console.error(`[Innovus TCL] 加载命令数据失败: ${err}`);
            this.loaded = true;
        }
    }

    /** 重新加载 */
    reload(): void {
        this.commands.clear();
        this.loaded = false;
        this.load();
    }

    /** 获取命令信息 */
    get(name: string): CmdInfo | undefined {
        this.load();
        return this.commands.get(name);
    }

    /** 获取所有命令名 */
    getCommandNames(): string[] {
        this.load();
        return Array.from(this.commands.keys());
    }

    /** 模糊搜索命令 */
    search(prefix: string, limit: number = 50): CmdInfo[] {
        this.load();
        const results: CmdInfo[] = [];
        const lower = prefix.toLowerCase();
        for (const [name, info] of this.commands) {
            if (name.toLowerCase().startsWith(lower)) {
                results.push(info);
                if (results.length >= limit) { break; }
            }
        }
        return results;
    }

    /** 检查是否为已知命令 */
    isCommand(name: string): boolean {
        this.load();
        const info = this.commands.get(name);
        return info !== undefined && info.is_cmd === true;
    }

    /** 检查是否为模式/变量设置项（非命令） */
    isModeVariable(name: string): boolean {
        this.load();
        const info = this.commands.get(name);
        return info !== undefined && info.is_cmd === false;
    }

    /** 检查是否为已知条目（命令或变量） */
    isKnown(name: string): boolean {
        this.load();
        return this.commands.has(name);
    }
}

/** 全局单例 */
let dbInstance: CommandDB | null = null;

export function getDB(extensionPath?: string): CommandDB {
    if (!dbInstance && extensionPath) {
        dbInstance = new CommandDB(extensionPath);
    }
    if (!dbInstance) {
        dbInstance = new CommandDB('');
    }
    return dbInstance;
}
