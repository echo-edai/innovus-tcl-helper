/**
 * 英文原始 help .log 文件解析器
 *
 * 解析 Innovus 原生的 "help <cmd>" 输出文本为 CmdInfo 结构
 *
 * 输入格式 (help_cmds/help_logs/help_<cmd>.log):
 *   Usage: cmdName [-help] -arg1 <val1> [-arg2 <val2>]
 *                    [-arg3] ...
 *   -help          # Prints out the command usage
 *   -arg1 <val1>   # Description (string, required)
 *   -arg2 <val2>   # Description continued
 *                  # more description (type, optional)
 */

import { CmdInfo, CmdOption } from './commands';

/**
 * 解析英文 help .log 原始文本为 CmdInfo
 */
export function parseHelpLog(cmdName: string, content: string): CmdInfo {
    const lines = content.split('\n');

    // 提取 Usage 行（可能跨多行）
    let usage = '';
    let optionLines: string[] = [];
    let inUsage = true;

    for (const line of lines) {
        if (inUsage) {
            if (line.startsWith('Usage:') || line.match(/^\s{15,}[-\[]/)) {
                // Usage 第一行或续行（缩进15+空格后以 - 或 [ 开头）
                usage += (usage ? ' ' : '') + line.trim();
            } else if (line.trim().startsWith('-')) {
                // 第一个 option 行，切换模式
                inUsage = false;
                optionLines.push(line);
            } else if (line.trim() === '') {
                // 空行，可能切换
                inUsage = false;
            }
        } else {
            if (line.trim()) {
                optionLines.push(line);
            }
        }
    }

    // 清理 Usage
    usage = usage.replace(/^Usage:\s*/, '').trim();

    // 解析选项参数
    const options = parseOptions(optionLines);
    const description = `Adds, modifies, or queries design objects related to '${cmdName}'.`;

    return {
        command: cmdName,
        is_cmd: true,
        summary: description,
        description: description,
        usage: usage,
        options: options
    };
}

/**
 * 解析选项行
 *
 * 格式:
 *   -flagName      # Description text (type, required/optional)
 *   -flagName <val># Description (type, required/optional)
 *   -flagName {v1 v2}  # Description (enum, optional)
 *                    # Description continuation line
 */
function parseOptions(lines: string[]): CmdOption[] {
    const options: CmdOption[] = [];
    let currentOption: { name: string; lines: string[] } | null = null;

    for (const line of lines) {
        // 检查是否为新选项行：以 - 开头（前面可能有少量空白）
        const optionMatch = line.match(/^(\s*)(-\w+)\b/);
        if (optionMatch) {
            // 保存前一个选项
            if (currentOption) {
                options.push(buildOption(currentOption.name, currentOption.lines));
            }
            currentOption = {
                name: optionMatch[2],
                lines: [line.trim()]
            };
        } else if (currentOption && line.trim()) {
            // 续行
            currentOption.lines.push(line.trim());
        }
    }

    // 保存最后一个选项
    if (currentOption) {
        options.push(buildOption(currentOption.name, currentOption.lines));
    }

    return options;
}

/**
 * 从多行文本构建 CmdOption
 */
function buildOption(name: string, lines: string[]): CmdOption {
    // 处理续行中的 # 注释前缀：将每行开头的 # 替换为空格
    const cleanedLines = lines.map((line, idx) => {
        if (idx === 0) { return line; } // 第一行保持原样（flag name 行）
        // 续行：去掉开头的空白和 #
        return line.replace(/^\s*#\s*/, ' ').trim();
    });

    // 合并描述行
    let fullText = cleanedLines.join(' ');

    // 移除开头的 flag 名称和可能的 value placeholder
    // 例如: "-cell <cellName>     # Name of cell (string, required)"
    // 保留 # 后面的描述部分
    const hashIdx = fullText.indexOf('#');
    let description = '';
    let type = 'flag';
    let required = false;

    if (hashIdx >= 0) {
        description = fullText.substring(hashIdx + 1).trim();
    } else {
        description = fullText.substring(name.length).trim();
    }

    // 从描述中提取类型和必需性
    // 格式: "... (type, required/optional)"
    const typeMatch = description.match(/\(([^)]+)\)\s*$/);
    if (typeMatch) {
        const typeStr = typeMatch[1].toLowerCase();
        description = description.substring(0, description.lastIndexOf('(')).trim();

        // 解析类型
        if (typeStr.includes('string')) { type = 'string'; }
        else if (typeStr.includes('bool')) { type = 'flag'; }
        else if (typeStr.includes('enum')) { type = 'enum'; }
        else if (typeStr.includes('int')) { type = 'int'; }
        else if (typeStr.includes('float')) { type = 'float'; }
        else if (typeStr.includes('point') || typeStr.includes('box')) { type = 'point'; }
        // 若 name 后有 <...> 或 {...} 且 type 尚为 flag → 修正
        else if (lines[0] && /[<{]/.test(lines[0])) { type = 'string'; }

        // 解析必需性
        required = typeStr.includes('required');
    }

    // 清理 description 中的多余空白
    description = description.replace(/\s+/g, ' ').trim();

    // 如果 name 带 value placeholder 且 type 不是 flag, 调整 type
    // e.g. "-cell <cellName>" → type 应该是 string
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
