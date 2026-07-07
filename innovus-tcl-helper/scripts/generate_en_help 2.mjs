#!/usr/bin/env node
/**
 * 英文 help .log → 结构化 JSON 批量转换脚本
 *
 * 用法:
 *   node scripts/generate_en_help.mjs
 *
 * 输入: data_base/en/ori_logs/help_logs/help_<cmd>.log
 * 输出: data_base/en/help/help_<cmd>.json
 *
 * 输出格式与 data_base/cn/help/ 一致，可直接被插件加载
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 路径配置
// scripts/ → innovus-tcl-helper/ → vscode-plugins/ → data_base/
const ROOT = path.join(__dirname, '..', '..');
const LOG_DIR = path.join(ROOT, 'data_base', 'en', 'ori_logs', 'help_logs');
const OUT_DIR = path.join(ROOT, 'data_base', 'en', 'help');

// ===================== 解析器（与 src/parser.ts 一致） =====================

/**
 * 解析英文 help .log 原始文本为结构化 JSON
 */
function parseHelpLog(cmdName, content) {
    const lines = content.split('\n');

    // 跳过 license/version header lines
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t.startsWith('Usage:') || t.startsWith('Description:') || t.startsWith('-') || t.startsWith('#') || t.startsWith('<')) {
            startIdx = i;
            break;
        }
    }

    // 检查是否为模式变量（非命令）- 以 # 开头而非 Usage
    const trimmedContent = content.trim();
    const isCmd = lines.some(l => l.trim().startsWith('Usage:'));

    if (!isCmd) {
        // 模式变量 / 设置项，不是真正的命令
        // 提取注释作为描述
        let description = '';
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('#')) {
                description += t.replace(/^#\s*/, '') + ' ';
            }
        }
        description = description.trim();
        return {
            command: cmdName,
            is_cmd: false,
            summary: description || `Mode setting: ${cmdName}`,
            description: description || `Mode setting variable for ${cmdName}.`,
            usage: null,
            options: null
        };
    }

    // 提取 Usage 行（可能跨多行）
    let usage = '';
    let optionLines = [];
    let inUsage = true;
    let foundUsage = false;

    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (inUsage) {
            // Usage 行或以大量空格缩进开始的续行
            if (trimmed.startsWith('Usage:') || (foundUsage && line.match(/^\s{10,}[-\[]/))) {
                usage += (usage ? ' ' : '') + trimmed;
                foundUsage = true;
            } else if (trimmed.startsWith('Description:')) {
                // 跳过 Description 行
                continue;
            } else if (trimmed.startsWith('-') || trimmed.startsWith('<')) {
                // 第一个 option 行
                inUsage = false;
                optionLines.push(line);
            } else if (trimmed === '' && foundUsage) {
                inUsage = false;
            }
        } else {
            if (trimmed) {
                optionLines.push(line);
            }
        }
    }

    usage = usage.replace(/^Usage:\s*/, '').trim();

    const options = parseOptions(optionLines);

    // 如果没有解析到 options 但有 usage（比如只有 -help 的命令），
    // 至少添加 -help 选项
    if (options.length === 0 && usage) {
        options.push({
            name: '-help',
            description: 'Prints out the command usage',
            required: false,
            type: 'flag'
        });
    }

    const summary = generateSummary(cmdName);
    const description = summary;

    return {
        command: cmdName,
        is_cmd: true,
        summary: summary,
        description: description,
        usage: usage || `${cmdName} [-help]`,
        options: options.length > 0 ? options : null
    };
}

function parseOptions(lines) {
    const options = [];
    let currentOption = null;

    for (const line of lines) {
        const trimmed = line.trim();
        // 匹配 -flagName 或 <positionalArg>
        const optionMatch = trimmed.match(/^(\s*)(-\w+|<\w+>)\b/);
        if (optionMatch) {
            if (currentOption) {
                options.push(buildOption(currentOption.name, currentOption.lines));
            }
            currentOption = {
                name: optionMatch[2],
                lines: [line]
            };
        } else if (currentOption && trimmed) {
            currentOption.lines.push(line);
        }
    }

    if (currentOption) {
        options.push(buildOption(currentOption.name, currentOption.lines));
    }

    return options;
}

function buildOption(name, lines) {
    const cleanedLines = lines.map((line, idx) => {
        if (idx === 0) { return line; }
        return line.replace(/^\s*#\s*/, ' ').trim();
    });

    let fullText = cleanedLines.join(' ');
    const hashIdx = fullText.indexOf('#');
    let description = '';
    let type = 'flag';
    let required = false;

    if (hashIdx >= 0) {
        description = fullText.substring(hashIdx + 1).trim();
    } else {
        description = fullText.substring(name.length).trim();
    }

    const typeMatch = description.match(/\(([^)]+)\)\s*$/);
    if (typeMatch) {
        const typeStr = typeMatch[1].toLowerCase();
        description = description.substring(0, description.lastIndexOf('(')).trim();

        if (typeStr.includes('string')) { type = 'string'; }
        else if (typeStr.includes('bool')) { type = 'flag'; }
        else if (typeStr.includes('enum')) { type = 'enum'; }
        else if (typeStr.includes('int')) { type = 'int'; }
        else if (typeStr.includes('float')) { type = 'float'; }
        else if (typeStr.includes('point') || typeStr.includes('box')) { type = 'point'; }

        required = typeStr.includes('required');
    }

    description = description.replace(/\s+/g, ' ').trim();

    if (lines[0] && lines[0].includes('<') && type === 'flag') {
        type = 'string';
    }

    return {
        name: name,
        description: description,
        required: required,
        type: type
    };
}

// ===================== 摘要生成 =====================

/**
 * 根据命令名生成合理的英文摘要
 * e.g. "addInst" → "Adds an instance to the design."
 *      "checkDesign" → "Checks the design."
 *      "report_timing" → "Reports timing analysis."
 *      "setPlaceMode" → "Sets placement mode options."
 */
function generateSummary(cmdName) {
    // 分离 camelCase 和 snake_case
    const words = cmdName
        .replace(/([a-z])([A-Z])/g, '$1 $2')     // camelCase → words
        .replace(/_/g, ' ')                        // snake_case → words
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 0);

    if (words.length === 0) { return `Executes the ${cmdName} command.`; }

    const first = words[0];
    const rest = words.slice(1).join(' ');

    // 动词映射
    const verbMap = {
        'add': ['Adds', ''],
        'check': ['Checks', ''],
        'create': ['Creates', ''],
        'delete': ['Deletes', ''],
        'remove': ['Removes', ''],
        'report': ['Reports', ''],
        'set': ['Sets', 'options'],
        'get': ['Gets', 'information'],
        'reset': ['Resets', ''],
        'save': ['Saves', ''],
        'load': ['Loads', ''],
        'write': ['Writes', ''],
        'read': ['Reads', ''],
        'init': ['Initializes', ''],
        'start': ['Starts', ''],
        'end': ['Ends', ''],
        'route': ['Routes', ''],
        'place': ['Places', ''],
        'verify': ['Verifies', ''],
        'generate': ['Generates', ''],
        'define': ['Defines', ''],
        'change': ['Changes', ''],
        'edit': ['Edits', ''],
        'update': ['Updates', ''],
        'select': ['Selects', ''],
        'deselect': ['Deselects', ''],
        'assign': ['Assigns', ''],
        'unassign': ['Unassigns', ''],
        'connect': ['Connects', ''],
        'disconnect': ['Disconnects', ''],
        'highlight': ['Highlights', ''],
        'dehighlight': ['Dehighlights', ''],
        'display': ['Displays', ''],
        'dump': ['Dumps', ''],
        'extract': ['Extracts', ''],
        'fix': ['Fixes', ''],
        'flatten': ['Flattens', ''],
        'merge': ['Merges', ''],
        'move': ['Moves', ''],
        'clone': ['Clones', ''],
        'copy': ['Copies', ''],
        'paste': ['Pastes', ''],
        'replace': ['Replaces', ''],
        'restore': ['Restores', ''],
        'run': ['Runs', ''],
        'sort': ['Sorts', ''],
        'split': ['Splits', ''],
        'swap': ['Swaps', ''],
        'trim': ['Trims', ''],
        'undo': ['Undoes', ''],
        'redo': ['Redoes', ''],
        'zoom': ['Zooms', ''],
        'cut': ['Cuts', ''],
        'attach': ['Attaches', ''],
        'detach': ['Detaches', ''],
        'commit': ['Commits', ''],
        'import': ['Imports', ''],
        'export': ['Exports', ''],
        'map': ['Maps', ''],
        'query': ['Queries', ''],
        'legalize': ['Legalizes', ''],
        'optimize': ['Optimizes', ''],
        'partition': ['Partitions', ''],
        'mark': ['Marks', ''],
        'unmark': ['Unmarks', ''],
        'analyze': ['Analyzes', ''],
        'find': ['Finds', ''],
    };

    if (verbMap[first]) {
        const [verb, suffix] = verbMap[first];
        const obj = rest || suffix || 'the design';
        return `${verb} ${obj}.`;
    }

    // 默认
    return `Executes the '${cmdName}' command.`;
}

// ===================== 主流程 =====================

function main() {
    if (!fs.existsSync(LOG_DIR)) {
        console.error(`❌ 源目录不存在: ${LOG_DIR}`);
        process.exit(1);
    }

    // 确保输出目录存在
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const logFiles = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
    console.log(`📂 找到 ${logFiles.length} 个 .log 文件`);

    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (const file of logFiles) {
        const cmdName = file.replace(/^help_/, '').replace(/\.log$/, '');
        if (!cmdName) {
            skipped++;
            continue;
        }

        const outFile = path.join(OUT_DIR, file.replace(/\.log$/, '.json'));

        // 如果 JSON 已存在且比 .log 新，跳过
        const logStat = fs.statSync(path.join(LOG_DIR, file));
        if (fs.existsSync(outFile)) {
            const jsonStat = fs.statSync(outFile);
            if (jsonStat.mtimeMs >= logStat.mtimeMs) {
                skipped++;
                continue;
            }
        }

        try {
            const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf-8');
            const info = parseHelpLog(cmdName, content);

            // 验证基本结构
            if (!info.command) {
                throw new Error('解析结果无命令名');
            }

            fs.writeFileSync(outFile, JSON.stringify(info, null, 2), 'utf-8');
            success++;
        } catch (err) {
            failed++;
            if (failed <= 5) {
                console.error(`  ⚠️  ${cmdName}: ${err.message}`);
            }
        }
    }

    console.log(`\n✅ 完成: ${success} 成功, ${failed} 失败, ${skipped} 跳过`);
    console.log(`📁 输出目录: ${OUT_DIR}`);
}

main();
