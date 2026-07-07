# 架构设计文档

## 整体架构

```
┌───────────────────────────────────────────────── ────────┐
│                    VS Code Extension Host                │
│                                                          │
│  ┌────────────── ┐  ┌──────────────┐  ┌────── ─────────┐ │
│  │ HoverProvider │  │  Completion  │  │  Diagnostics   │ │
│  │   (hover.ts)  │  │ (completion  │  │ (diagnostics   │ │
│  │               │  │    .ts)      │  │    .ts)        │ │
│  └──────┬────────┘  └──────┬───────┘  └─────── ┬───────┘ │
│         │                  │                   │         │
│         └──────────────────┼───────────────────┘         │
│                            │                             │
│                    ┌───────▼───────┐                     │
│                    │   CommandDB   │                     │
│                    │  (commands.ts)│                     │
│                    └───────┬───────┘                     │
│                            │                             │
│                    ┌───────▼───────┐                     │
│                    │  JSON Files   │                     │
│                    │  (data_base/) │                     │
│                    └───────────────┘                     │
└───────────────────────────────────────────────────────── ┘
```

## 模块详解

### 1. `extension.ts` — 插件入口

**职责**：激活/停用生命周期管理，注册所有 Provider 和 Command。

```typescript
activate(context) → 读取配置 → 初始化 DB → 注册 Provider → 注册命令
deactivate()      → 清理 Diagnostics
```

**激活条件**：`onLanguage:tcl` — 仅在打开 `.tcl` 文件时激活，不占用非 TCL 项目资源。

**配置读取**：每次激活时从 `vscode.workspace.getConfiguration('innovus-tcl')` 读取：

- 各 Provider 可独立开关
- 数据库路径可自定义

### 2. `commands.ts` — 命令数据库

**设计模式**：单例模式 + 懒加载。

```
CommandDB (单例)
├── Map<string, CmdInfo>  // 命令名 → 命令信息
├── load()                // 遍历 data_base/help/deepseek-chat/*.json
├── get(name)             // O(1) 精确查找
├── search(prefix)        // 前缀模糊搜索
├── isCommand(name)       // 是否存在
└── reload()              // 清空并重新加载
```

**数据结构**：

```typescript
interface CmdInfo {
    command: string;       // e.g. "addInst"
    is_cmd: boolean;       // 始终为 true
    summary: string;       // 中文摘要
    description: string;   // 中文详细描述
    usage: string;         // 命令语法
    options: CmdOption[];  // 参数列表
}

interface CmdOption {
    name: string;          // e.g. "-cell"
    description: string;   // 中文说明
    required: boolean;
    type: string;          // "string"|"flag"|"enum"|"point"|"int"|"float"
}
```

**性能设计**：

- **懒加载**：首次调用 `get()` / `getCommandNames()` 时才读取文件
- **单次遍历**：一次 `fs.readdirSync` + 逐个 `fs.readFileSync`，无递归
- **内存占用**：2175 条命令 × ~1KB/条 ≈ 2.5MB（Map 内存）
- **查找速度**：`Map.get()` 为 O(1) 哈希查找

### 3. `hover.ts` — 悬停提示

**触发时机**：鼠标悬停在 TCL 文件中的任意单词上。

**处理流程**：

```
获取光标位置单词 → 查询 CommandDB → 命中？→ 构建 Markdown → 返回 Hover
                                    → 未命中？→ 返回 null（不干扰其他 Provider）
```

**Markdown 内容结构**：

1. 命令名（二级标题）
2. 中文摘要（加粗）
3. 语法代码块（tcl 语法高亮）
4. 详细说明
5. 参数表格（参数名 / 必需 / 类型 / 说明）

### 4. `completion.ts` — 自动补全

**触发时机**：输入空格 、破折号 `-`、下划线 `_` 时触发。

**两阶段判断**：

| 场景       | 判断条件                                | 行为                 |
| ---------- | --------------------------------------- | -------------------- |
| 命令名补全 | 行首/刚换行，只有一个词且不以`-` 开头 | 列出全部 2175 个命令 |
| 参数补全   | 行中已有命令名 + 空格，在参数位置       | 列出该命令的参数     |

**参数补全优化**：

- 已使用的 `flag` 类型参数不再提示（避免重复）
- 必需参数排在可选参数前面（`sortText: "0"` vs `"1"`）
- 枚举参数在文档中显示可选值

**触发器字符**：`[' ', '-', '_']`，覆盖 TCL 命令分隔和参数前缀。

### 5. `diagnostics.ts` — 静态检查

**触发时机**：保存文件时（`onDidSaveTextDocument`）+ 切换编辑器时。

**检查项**：

| 检查项           | 等级    | 实现                            |
| ---------------- | ------- | ------------------------------- |
| 多余`]`        | Error   | 逐行计数，`depth < 0` 时报错  |
| 多余`}`        | Error   | 同上                            |
| 缺少`]`        | Error   | 文档末尾`depth > 0`           |
| 缺少`}`        | Error   | 同上                            |
| 未闭合`"`      | Error   | 逐行状态机，支持`\"` 转义     |
| 命令缺少必需参数 | Warning | 对比 JSON 中的`required` 参数 |

**TCL 特殊性处理**：

- 跳过 `#` 开头的注释行
- 跳过行内 `#` 注释之后的内容（非转义）
- 跳过 TCL 内置命令（`set`, `if`, `for`, `puts` 等 40+ 个）
- 不报告未知命令（TCL 允许自定义 `proc`）

## 技术选型理由

| 决策                 | 理由                                         |
| -------------------- | -------------------------------------------- |
| TypeScript           | VS Code 原生 API，类型安全，编译期查错       |
| 零运行时依赖         | 减小插件体积，避免依赖冲突                   |
| 同步文件 I/O         | 数据加载仅在激活时执行一次，同步加载简单可靠 |
| Map 数据结构         | O(1) 查找，ES6 原生支持                      |
| DiagnosticCollection | VS Code 标准诊断 API，自动关联文档生命周期   |
