# 数据来源与处理流程

## 数据源头

Innovus 命令文档的原始数据来自 Cadence Innovus 工具自带的帮助系统。

### 三层数据

```
data_base/
├── innovus_cmd_db/
│   ├── all_cmds.json           # 全部命令名列表（去重后的汇总）
│   ├── help_cmds/help_logs/    # help <cmd> 的原始输出（简要用法）
│   ├── man_cmds/man_logs/      # man <cmd> 的原始输出（详细手册）
│   └── sort_cmds_jsons/        # 按首字母分组的命令名 JSON
│
├── help/deepseek-chat/         # ★ 插件使用的数据 ★
│   └── help_<cmd>.json         # DeepSeek 结构化后的中文命令文档
│
└── man/deepseek-chat/          # 结构化后的详细手册（备用，当前未使用）
    └── env_PAGER=cat_man_<cmd>.json
```

### 原始数据格式

**help 原始输出** (`help_addInst.log`)：
```
Usage: addInst [-help] -cell <cellName> [-dontSnapToPlacementGrid]
               -inst <instName> [-loc {x y}] [-moduleBased <moduleName>]
               [-ori <orientation>] [-physical]
               [-place_status {fixed soft_fixed placed unplaced cover}]

-help                         # Prints out the command usage
-cell <cellName>              # Name of cell (string, required)
...
```

**man 原始输出** (`env_PAGER=cat_man_addInst.log`)：
```
Product Version     25.10    Cadence Design Systems, Inc.
addInst(25.10)

Name
       addInst - Adds an instance and places it in the design

Syntax
       addInst
       [-help]
       ...
```

### DeepSeek 处理

原始 help/man 文本经 DeepSeek 大模型结构化处理，输出 JSON：

```json
{
  "command": "addInst",
  "is_cmd": true,
  "summary": "添加一个实例到设计中",
  "description": "该命令用于在设计中添加一个新的实例。可以指定实例的名称、所属的单元...",
  "usage": "addInst [-help] -cell <cellName> ...",
  "options": [
    {
      "name": "-help",
      "description": "打印命令用法",
      "required": false,
      "type": "flag"
    },
    {
      "name": "-cell",
      "description": "单元名称",
      "required": true,
      "type": "string"
    }
    // ...
  ]
}
```

**处理内容**：
- 原文翻译为中文
- 提取命令名、用法语法
- 参数结构化（名称、类型、是否必需、描述）
- 生成一句话摘要

### 为何选择 help 而非 man

| 维度 | help | man |
|------|------|-----|
| 内容 | 参数列表 + 简要说明 | 全文手册 |
| JSON 大小 | ~1-2KB | ~5-20KB |
| 悬停展示 | 简洁清晰，一目了然 | 过长，不适合 popup |
| 加载速度 | 快（小文件） | 慢 |
| 覆盖率 | 2175 条 | 约 2000+ 条 |

## 数据加载流程

```
extension.ts: activate()
    │
    ▼
commands.ts: CommandDB.load()
    │
    ├─ 检查 dataDir 是否存在
    ├─ fs.readdirSync() 获取所有 .json 文件名
    ├─ for each file:
    │   ├─ fs.readFileSync() 读取文件内容
    │   ├─ JSON.parse() 解析
    │   └─ commands.set(cmdName, cmdInfo)
    │
    └─ 设置 loaded = true
```

### 路径解析

```
插件目录: .../innovus-tcl-helper/
数据目录: .../data_base/help/deepseek-chat/

相对路径: path.join(extensionPath, '..', 'data_base', 'help', 'deepseek-chat')
                                  ↑
                              回到 vscode-plugins/ 目录
```

### 加载性能

在 MacBook Pro (M-series) 上实测：

| 指标 | 数值 |
|------|------|
| JSON 文件数 | 2,175 |
| 总数据量 | ~4.5MB |
| 首次加载时间 | ~200ms（同步 I/O） |
| 内存占用 | ~15MB（含 V8 堆） |
| 命令查找 | O(1) Map.get() |

## 数据更新流程

当 Innovus 版本更新导致命令变化时：

1. 重新导出 `help <cmd>` 输出到 `help_cmds/help_logs/`
2. 运行 DeepSeek 结构化脚本（用户自有）
3. 输出新的 JSON 到 `help/deepseek-chat/`
4. 在 VS Code 中执行 `Innovus TCL: 重新加载命令数据库`
5. 或直接重启 VS Code
