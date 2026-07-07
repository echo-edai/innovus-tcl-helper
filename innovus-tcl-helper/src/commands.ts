/**
 * Innovus 命令数据库 - 轻量级命令信息加载与查询
 *
 * 数据来源（按语言）:
 *   中文 (zh): data_base/cn/help/   ← DeepSeek 结构化翻译 JSON，2175 条
 *   英文 (en): data_base/en/help/   ← 结构化 JSON（如存在）
 *             data_base/en/ori_logs/help_logs/  ← 原生 help .log，实时解析，2192 条
 *
 * 版本选择:
 *   目录约定: data_base/{cn|en}/v{version}/help/
 *   如未指定版本，使用 data_base/{cn|en}/help/ （当前唯一版本）
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseHelpLog } from './parser';

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
    private dataRoot: string;        // data_base 根目录
    private language: Language = 'zh';
    private version: string = '';    // Innovus 版本号，如 "25.1"

    constructor(extensionPath: string) {
        // 数据根目录发现优先级：
        // 1. 扩展内置 data/ 目录（打包后）
        // 2. 同级目录下的 data_base/（开发时）
        const bundled = path.join(extensionPath, 'data');
        if (fs.existsSync(bundled)) {
            this.dataRoot = bundled;
        } else {
            this.dataRoot = path.join(extensionPath, '..', 'data_base');
        }
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

    /** 设置 Innovus 版本 */
    setVersion(ver: string): void {
        if (this.version !== ver) {
            this.version = ver;
            this.reload();
        }
    }

    /** 获取当前版本 */
    getVersion(): string {
        return this.version;
    }

    /** 扫描可用的 Innovus 版本列表 */
    getAvailableVersions(): { label: string; description: string }[] {
        const base = this.dataRoot;
        const lang = this.language;
        const rootDir = path.join(base, lang);

        // 内置版本: 25.1 (真实数据), test (空数据/关闭高亮)
        const versions: { label: string; description: string }[] = [
            { label: '(默认)', description: 'Innovus 25.1 — 2175 个命令' },
            { label: '25.1', description: 'Innovus 25.1 — 2175 个命令' },
            { label: 'test', description: '测试模式 — 无命令数据，关闭 Innovus 高亮/提示' }
        ];

        // 扫描额外的自定义版本目录
        if (fs.existsSync(rootDir)) {
            try {
                const entries = fs.readdirSync(rootDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory() || !entry.name.startsWith('v')) { continue; }
                    const ver = entry.name.substring(1);
                    // 跳过已内置的
                    if (ver === '25.1' || ver === 'test') { continue; }
                    const helpDir = path.join(rootDir, entry.name, 'help');
                    if (fs.existsSync(helpDir)) {
                        versions.push({ label: ver, description: `自定义版本: ${ver}` });
                    }
                }
            } catch { /* ignore */ }
        }

        return versions;
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
            version: this.version || '(默认)',
            language: this.language
        };
    }

    /** 设置自定义 data_base 根路径 */
    setDataRoot(dir: string): void {
        if (dir && fs.existsSync(dir)) {
            this.dataRoot = dir;
            this.reload();
        }
    }

    /** 获取数据文件所在目录 */
    private getDataSourceDir(): string {
        const base = this.dataRoot;
        const lang = this.language;
        const ver = this.version;

        // 特殊版本处理:
        //   "25.1" → 使用默认 help/ 目录（当前唯一真实数据）
        //   "test" → vtest/help/ 空目录（关闭所有 Innovus 高亮/提示）
        //   其他   → v{version}/help/ 自定义版本目录

        const getVersionDir = (): string => {
            if (!ver) { return path.join(base, lang, 'help'); }
            if (ver === '25.1') { return path.join(base, lang, 'help'); }
            // test 或其他自定义版本
            return path.join(base, lang, `v${ver}`, 'help');
        };

        if (lang === 'en') {
            const verDir = getVersionDir();
            if (fs.existsSync(verDir)) {
                const testFiles = fs.readdirSync(verDir).filter(f => f.endsWith('.json'));
                if (testFiles.length > 0) { return verDir; }
            }
            // 回退到原始 .log 解析
            const logDir = path.join(base, 'en', 'ori_logs', 'help_logs');
            if (fs.existsSync(logDir)) { return logDir; }
            return verDir; // 返回目录路径（即使为空）
        }

        // 中文
        return getVersionDir();
    }

    /** 加载命令数据 */
    load(): void {
        if (this.loaded) { return; }

        try {
            if (this.language === 'en') {
                this.loadEnglish();
            } else {
                this.loadChinese();
            }
            this.loaded = true;
            console.log(`[Innovus TCL] 已加载 ${this.commands.size} 个命令 (语言: ${this.language})`);
        } catch (err) {
            console.error(`[Innovus TCL] 加载命令数据失败: ${err}`);
        }
    }

    /** 加载中文 JSON 数据 */
    private loadChinese(): void {
        const dataDir = this.getDataSourceDir();
        if (!fs.existsSync(dataDir)) {
            console.warn(`[Innovus TCL] 中文数据目录不存在: ${dataDir}`);
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
    }

    /** 加载英文数据（优先 JSON，回退 .log 解析） */
    private loadEnglish(): void {
        const dataDir = this.getDataSourceDir();
        if (!fs.existsSync(dataDir)) {
            console.warn(`[Innovus TCL] 英文数据目录不存在: ${dataDir}`);
            return;
        }

        // 检查是否包含 JSON 文件（结构化数据）
        const jsonFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
        if (jsonFiles.length > 0) {
            // 英文结构化 JSON（en/help/ 目录）
            for (const file of jsonFiles) {
                try {
                    const filePath = path.join(dataDir, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const info: CmdInfo = JSON.parse(content);
                    if (info.command) {
                        this.commands.set(info.command, info);
                    }
                } catch {
                    // 跳过
                }
            }
            return;
        }

        // 回退：解析原始 .log 文件
        const logFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.log'));
        for (const file of logFiles) {
            try {
                // 文件名格式: help_<cmdName>.log
                const cmdName = file.replace(/^help_/, '').replace(/\.log$/, '');
                if (!cmdName) { continue; }

                const filePath = path.join(dataDir, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const info = parseHelpLog(cmdName, content);
                if (info.command) {
                    this.commands.set(info.command, info);
                }
            } catch {
                // 跳过解析失败的文件
            }
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
