# 更新日志

## 0.4.0 (2026-07-07)

### 新增 — 跨文件 TCL 编译分析
- **`.f` 文件驱动的编译引擎**：通过 `tcl.f`（可配置）指定所有 TCL 脚本的编译列表和顺序
- **跨文件变量追踪**：按 `.f` 文件顺序编译所有脚本，构建全局符号表
- **悬浮变量值查看**：鼠标悬停在 `$varName` 或变量名上，自动显示其值和定义位置
- **跨文件变量错误检测**：未定义变量引用、变量使用在定义之前等诊断
- **增量编译**：文件保存时自动增量更新，不影响其他文件的状态
- **`.f` 文件变化自动重编译**：保存 `.f` 文件时自动触发全量重编译
- **Lint 报告导出**：支持 Markdown 和 JSON 格式的 Lint 报告
- **新增命令**：
  - `Innovus TCL: 🔍 运行跨文件 Lint` — 手动触发编译分析
  - `Innovus TCL: 📊 显示 Lint 报告` — 查看/导出 Lint 报告
  - `Innovus TCL: 📄 打开 .f 编译文件` — 打开/创建 `.f` 文件
- **新增配置项**：
  - `innovus-tcl.enableCompilation` — 启用跨文件编译分析（默认开启）
  - `innovus-tcl.fFile` — `.f` 文件路径（默认 `tcl.f`）

### 改进
- Hover Provider 现在支持显示 TCL 变量的值和定义位置
- 诊断面板同时支持单文件语法检查和跨文件编译错误
- 插件信息面板显示编译分析启用状态

## 0.3.0 (2026-07-07)

### 新增 — 多版本支持
- **多版本数据目录自动扫描**：`data/innovus/` 下每新增一个工具/版本目录即可自动识别
- **快速切换版本**：`Innovus TCL: 切换 Innovus 版本` 命令，无需重启 VS Code
- 内置 `25.1`（Innovus 生产版）和 `test`（空数据测试版）

### 新增 — 增强静态检查（三级诊断）
- **`basic`** — 括号匹配 + 引号匹配
- **`standard`**（默认）— basic + 命令参数必需性检查（区分必选/可选参数）
- **`strict`** — standard + 相似命令建议（Levenshtein 距离）+ 参数类型验证 + 重复参数检测
- 新增配置项 `innovus-tcl.diagnosticLevel`（`basic` / `standard` / `strict`）

### 新增 — Copilot AI 集成
- **MCP Server** (`scripts/mcp-server.mjs`)：暴露 3 个 LM Tools 供 Copilot 调用
  - `innovus_list_commands` — 列出所有 Innovus 命令
  - `innovus_get_command_help` — 获取指定命令的完整帮助文档
  - `innovus_parse_tcl_script` — 解析 TCL 脚本中的所有 Innovus 命令及其参数
- **AI 分析 TCL 脚本**：`Innovus TCL: AI 分析当前 TCL 脚本` 命令，自动调用 MCP 工具获取命令文档，生成 Markdown 格式的流程分析报告
- **一键安装 MCP**：`Innovus TCL: 🤖 一键安装 Copilot MCP 工具` 命令
- **可自定义 AI 提示词**：`Innovus TCL: ✏️ 编辑 AI 分析提示词` 命令
- 新增配置项 `innovus-tcl.enableAITools`（默认开启）

### 改进
- 降低 VS Code 引擎要求至 `^1.67.0`，提升兼容范围
- 数据路径重构：移除 `dataRoot` 配置，统一使用工作区相对路径
- 提示词文件化：AI 分析提示词移至 `prompts/` 目录，支持中英文独立配置

### 修复
- 语言 `zh` → 目录名 `cn` 路径映射 bug
- 发布管线：防泄漏 `.gitignore` + VSIX 输出到 `publish/` 目录
- `prepublish` 脚本 `rm -rf` 在 Node v25 / macOS 下的兼容性问题

## 0.2.1 (2026-07-07)

### 新增
- 双模式帮助显示：Webview 富文本面板 + 纯文本 man page
- Ctrl+Shift+P 切换帮助风格（`innovus-tcl.toggleHelpStyle`）
- Webview 教育化：参数分析卡片、相关命令、使用提示
- Semantic Tokens 语法高亮（命令/参数/变量着色）
- 语言自动检测（`auto` / `zh` / `en`）
- DocumentLinkProvider：Webview 模式 Ctrl+Click 直达
- 必选参数精确诊断（解析命令行参数）

### 修复
- 代码块下划线 `\_` 转义渲染问题
- 移除冗余 TCL 语言声明（避免覆盖内置语法高亮）
- 打包脚本 `rm -rf` 在 Node v25 / macOS 兼容性

## 0.1.0 (2026-07-07)

### 新增
- 悬停提示：鼠标悬浮在 Innovus 命令名上显示中英文文档
- 自动补全：命令名 + 参数名（区分必选/可选）
- 静态检查：括号匹配、引号匹配、必需参数缺失警告
- F12/Ctrl+Click 跳转到虚拟帮助文档
- 集成 2175 个 Innovus 命令文档
