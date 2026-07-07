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

    /** 设置 Innovus 版本（暂未启用，预留给未来多版本支持） */
    setVersion(ver: string): void {
        if (this.version !== ver) {
            this.version = ver;
            this.reload();
        }
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
        if (this.language === 'en') {
            // 英文：优先加载 en/help/ 结构化 JSON，如不存在则解析 en/ori_logs/help_logs/ 原始 .log
            if (this.version) {
                const versionHelpDir = path.join(base, 'en', `v${this.version}`, 'help');
                if (fs.existsSync(versionHelpDir)) { return versionHelpDir; }
            }
            const enHelpDir = path.join(base, 'en', 'help');
            if (fs.existsSync(enHelpDir)) {
                // 英文结构化 JSON 存在时使用
                const testFiles = fs.readdirSync(enHelpDir).filter(f => f.endsWith('.json'));
                if (testFiles.length > 0) { return enHelpDir; }
            }
            // 回退到原始 .log 解析
            return path.join(base, 'en', 'ori_logs', 'help_logs');
        }
        // 中文：cn/help/ 结构化 JSON
        if (this.version) {
            return path.join(base, 'cn', `v${this.version}`, 'help');
        }
        return path.join(base, 'cn', 'help');
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
                if (info.command && info.is_cmd) {
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
                    if (info.command && info.is_cmd) {
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
