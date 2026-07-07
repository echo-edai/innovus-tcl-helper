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

// scripts/ → innovus-tcl-helper/ → vscode-plugins/ → data_base/
const ROOT = path.join(__dirname, '..', '..');
const LOG_DIR = path.join(ROOT, 'data_base', 'en', 'ori_logs', 'help_logs');
const OUT_DIR = path.join(ROOT, 'data_base', 'en', 'help');

// ===================== 摘要生成 =====================

function generateSummary(cmdName) {
    const words = cmdName
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 0);
    if (words.length === 0) { return `Executes the '${cmdName}' command.`; }

    const first = words[0];
    const rest = words.slice(1);

    const verbMap = {
        'add': 'Adds', 'check': 'Checks', 'create': 'Creates', 'delete': 'Deletes',
        'remove': 'Removes', 'report': 'Reports', 'set': 'Sets', 'get': 'Gets',
        'reset': 'Resets', 'save': 'Saves', 'load': 'Loads', 'write': 'Writes',
        'read': 'Reads', 'init': 'Initializes', 'start': 'Starts', 'end': 'Ends',
        'route': 'Routes', 'place': 'Places', 'verify': 'Verifies',
        'generate': 'Generates', 'define': 'Defines', 'change': 'Changes',
        'edit': 'Edits', 'update': 'Updates', 'select': 'Selects',
        'deselect': 'Deselects', 'assign': 'Assigns', 'unassign': 'Unassigns',
        'connect': 'Connects', 'disconnect': 'Disconnects', 'highlight': 'Highlights',
        'dehighlight': 'Dehighlights', 'display': 'Displays', 'dump': 'Dumps',
        'extract': 'Extracts', 'fix': 'Fixes', 'flatten': 'Flattens',
        'merge': 'Merges', 'move': 'Moves', 'clone': 'Clones', 'copy': 'Copies',
        'paste': 'Pastes', 'replace': 'Replaces', 'restore': 'Restores',
        'run': 'Runs', 'sort': 'Sorts', 'split': 'Splits', 'swap': 'Swaps',
        'trim': 'Trims', 'undo': 'Undoes', 'redo': 'Redoes', 'zoom': 'Zooms',
        'cut': 'Cuts', 'attach': 'Attaches', 'detach': 'Detaches',
        'commit': 'Commits', 'import': 'Imports', 'export': 'Exports',
        'map': 'Maps', 'query': 'Queries', 'legalize': 'Legalizes',
        'partition': 'Partitions', 'mark': 'Marks', 'unmark': 'Unmarks',
        'analyze': 'Analyzes', 'find': 'Finds', 'apply': 'Applies',
        'assemble': 'Assembles', 'bind': 'Binds', 'calculate': 'Calculates',
        'clear': 'Clears', 'close': 'Closes', 'colorize': 'Colorizes',
        'compare': 'Compares', 'compress': 'Compresses', 'convert': 'Converts',
        'decompress': 'Decompresses', 'derive': 'Derives', 'disable': 'Disables',
        'enable': 'Enables', 'encrypt': 'Encrypts', 'decrypt': 'Decrypts',
        'eval': 'Evaluates', 'fill': 'Fills', 'filter': 'Filters',
        'flip': 'Flips', 'free': 'Frees', 'group': 'Groups',
        'insert': 'Inserts', 'justify': 'Justifies', 'list': 'Lists',
        'modify': 'Modifies', 'monitor': 'Monitors', 'open': 'Opens',
        'pack': 'Packs', 'predict': 'Predicts', 'prepare': 'Prepares',
        'print': 'Prints', 'propagate': 'Propagates', 'pull': 'Pulls',
        'push': 'Pushes', 'rechain': 'Rechains', 'reclaim': 'Reclaims',
        'recreate': 'Recreates', 'redirect': 'Redirects', 'refine': 'Refines',
        'register': 'Registers', 'reinforce': 'Reinforces', 'relink': 'Relinks',
        'rename': 'Renames', 'resize': 'Resizes', 'resume': 'Resumes',
        'scale': 'Scales', 'shift': 'Shifts', 'show': 'Shows', 'skew': 'Skews',
        'snap': 'Snaps', 'space': 'Spaces', 'specify': 'Specifies',
        'stagger': 'Staggers', 'stretch': 'Stretches', 'suppress': 'Suppresses',
        'suspend': 'Suspends', 'synthesize': 'Synthesizes', 'trace': 'Traces',
        'translate': 'Translates', 'unfix': 'Unfixes', 'unflatten': 'Unflattens',
        'ungroup': 'Ungroups', 'uniquify': 'Uniquifies', 'unload': 'Unloads',
        'unlock': 'Unlocks', 'unplace': 'Unplaces', 'unregister': 'Unregisters',
        'unset': 'Unsets', 'unspecify': 'Unspecifies', 'unsuppress': 'Unsuppresses',
        'validate': 'Validates', 'view': 'Views', 'summarize': 'Summarizes',
        'all': 'Returns all', 'db': 'Database',
        'ccopt': 'Clock concurrent optimization',
        'eco': 'Engineering change order',
        'sroute': 'Special route', 'fcroute': 'Flip-chip route',
        'oa': 'OpenAccess', 'sdc': 'SDC',
        'ctd': 'Clock tree debug', 'cvd': 'Cell view',
    };

    if (verbMap[first]) {
        const verb = verbMap[first];
        if (rest.length > 0) { return `${verb} ${rest.join(' ')}.`; }
        return `${verb} the design.`;
    }
    return `Executes the '${cmdName}' command.`;
}

// ===================== 解析器 =====================

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
    if (lines[0] && lines[0].includes('<') && type === 'flag') { type = 'string'; }

    return { name, description, required, type };
}

function parseOptions(lines) {
    const options = [];
    let cur = null;
    for (const line of lines) {
        const trimmed = line.trim();
        const m = trimmed.match(/^(\s*)(-\w+|<\w+>)/);
        if (m) {
            if (cur) { options.push(buildOption(cur.name, cur.lines)); }
            cur = { name: m[2], lines: [line] };
        } else if (cur && trimmed) {
            cur.lines.push(line);
        }
    }
    if (cur) { options.push(buildOption(cur.name, cur.lines)); }
    return options;
}

function parseHelpLog(cmdName, content) {
    const lines = content.split('\n');
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t.startsWith('Usage:') || t.startsWith('Description:') ||
            t.startsWith('-') || t.startsWith('#') || t.startsWith('<')) {
            startIdx = i; break;
        }
    }

    const isCmd = lines.some(l => l.trim().startsWith('Usage:'));
    if (!isCmd) {
        let desc = '';
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('#')) { desc += t.replace(/^#\s*/, '') + ' '; }
        }
        desc = desc.trim() || `Mode setting: ${cmdName}`;
        return { command: cmdName, is_cmd: false, summary: desc, description: desc, usage: null, options: null };
    }

    let usage = '';
    let optionLines = [];
    let inUsage = true;
    let foundUsage = false;

    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (inUsage) {
            if (trimmed.startsWith('Usage:') || (foundUsage && line.match(/^\s{10,}[-\[]/))) {
                usage += (usage ? ' ' : '') + trimmed;
                foundUsage = true;
            } else if (trimmed.startsWith('Description:')) {
                continue;
            } else if (trimmed.startsWith('-') || trimmed.startsWith('<')) {
                inUsage = false; optionLines.push(line);
            } else if (trimmed === '' && foundUsage) {
                inUsage = false;
            }
        } else {
            if (trimmed) { optionLines.push(line); }
        }
    }

    usage = usage.replace(/^Usage:\s*/, '').trim();
    const options = parseOptions(optionLines);
    if (options.length === 0 && usage) {
        options.push({ name: '-help', description: 'Prints out the command usage', required: false, type: 'flag' });
    }

    const summary = generateSummary(cmdName);
    return {
        command: cmdName, is_cmd: true,
        summary, description: summary,
        usage: usage || `${cmdName} [-help]`,
        options: options.length > 0 ? options : null
    };
}

// ===================== 主流程 =====================

function main() {
    if (!fs.existsSync(LOG_DIR)) { console.error(`❌ 源目录不存在: ${LOG_DIR}`); process.exit(1); }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const logFiles = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
    console.log(`📂 找到 ${logFiles.length} 个 .log 文件`);
    let success = 0, failed = 0;
    for (const file of logFiles) {
        const cmdName = file.replace(/^help_/, '').replace(/\.log$/, '');
        if (!cmdName) { continue; }
        const outFile = path.join(OUT_DIR, file.replace(/\.log$/, '.json'));
        try {
            const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf-8');
            const info = parseHelpLog(cmdName, content);
            if (!info.command) { throw new Error('no command'); }
            fs.writeFileSync(outFile, JSON.stringify(info, null, 2), 'utf-8');
            success++;
        } catch (err) {
            failed++;
            if (failed <= 3) { console.error(`  ⚠️  ${cmdName}: ${err.message}`); }
        }
    }
    console.log(`\n✅ 完成: ${success} 成功, ${failed} 失败`);
    console.log(`📁 输出目录: ${OUT_DIR}`);
}

main();
