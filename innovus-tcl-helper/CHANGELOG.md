# 更新日志

## 0.6.0 (2026-07-08)

### 新增 — AI 驱动的 Innovus 命令仿真器
- **DeepSeek Flash 数据生成脚本**：`scripts/generate-simulations.mjs`
  - 遍历 2175 个 Innovus 命令，调用 AI 生成仿真输出
  - 并发控制（3 并发）+ 限流重试 + 增量生成
  - 支持 `--lang cn|en`、`--limit N`、`--dry-run`
- **仿真数据格式**：`data/simulations/<lang>/<cmdName>.json`
- **Runner 自动加载仿真**：有数据用仿真，无数据回退文档输出

### 待完成
- 执行 `node scripts/generate-simulations.mjs --lang cn` 批量生成

## 0.5.2 (2026-07-08)

### 改进 — 编辑器按钮优化
- **纯图标按钮**：`editor/title` + `navigation`，仅显示 Codicon 图标无文字
- **区分图标**：`$(play)` 运行文件 + `$(run-all)` 运行项目
- **鼠标悬停提示**：command title 自动作为 tooltip 显示
- **tsconfig 修复**：添加 `types: ["node"]` 解决 fs/path 类型错误

## 0.5.1 (2026-07-08)

### 新增 — 跨平台 tclsh 支持
- **平台子目录结构**：`bin/<platform>/tclsh9.0`，自动检测 `os.platform() + os.arch()`
- **已支持平台**：darwin-arm64（已编译 macOS Apple Silicon）
- **待编译平台**：darwin-x64 / linux-x64 / linux-arm64 / win32-x64
- **查找优先级**：内置（平台子目录）> 用户配置（`innovus-tcl.tclshPath`）> 系统搜索
- **各平台候选路径**：macOS（Homebrew）、Linux（/usr/bin）、Windows（PATH）

### 新增 — 运行输出文件保存
- **配置项 `innovus-tcl.runSaveOutput`**：是否保存运行输出到文件（默认 `false`）
- **配置项 `innovus-tcl.runOutputDir`**：输出目录（默认工作区 `.innovus-run/`）
- **日志格式**：时间戳文件名，含 stdout、stderr、Innovus 命令列表
- **自动创建目录**：输出目录不存在时自动递归创建
- **输出通道文件提示**：运行时显示 `📄 Output: /path/to/file.log`

### 新增 — .f 项目运行 + 编辑器按钮
- **新命令 `innovus-tcl.runProject`**：按 .f 文件顺序运行整个项目
- **统一包装器**：预扫描所有文件中的 Innovus 命令，生成共享 proc 包装器
- **逐文件运行**：按编译顺序执行，每个文件使用其所在目录作为工作目录
- **编辑器右上角按钮**：`editor/title/run` 贡献点，仅在 TCL 文件中显示
  - ▶️ 运行当前文件
  - 📦 运行 .f 项目
- **汇总报告**：文件数、错误数、总耗时、逐文件状态

### 改进
- `runner.ts`：完全重写，`findTclsh` 支持 `extensionPath` + `configTclshPath`
- `runner.ts`：新增 `RunOutputConfig` 接口 + `saveOutputFile` 方法
- `runner.ts`：移除对 `vscode` 模块的直接依赖，支持独立测试
- `extension.ts`：新增 `runProject` 命令 + 输出文件配置读取
- `package.json`：新增 5 个命令/配置项 + `menus.editor/title/run`

## 0.5.0 (2026-07-08)

### 新增 — TCL 脚本运行引擎
- **基于 tclsh9.0 的执行引擎**：通过 child_process 调用系统 tclsh 执行 TCL 代码
- **Innovus 命令智能拦截**：自动检测脚本中的 Innovus 专有命令，注入文档包装器
- **文档输出代替执行**：Innovus 命令（如 `addRing`、`routeDesign`）不报错，而是输出命令文档（语法、参数说明）
- **标准 TCL 正常执行**：`set`、`puts`、`if`、`proc`、`expr` 等标准命令正常执行
- **输出通道**：专门的 `Innovus TCL: Run` 输出面板，实时显示运行结果
- **自动查找 tclsh**：按优先级搜索 Homebrew tclsh9.0 → 系统 tclsh
- **错误捕获**：TCL 运行时错误（未定义变量、语法错误等）正确捕获并显示

### 新增 — VS Code 命令
- **`Innovus TCL: ▶️ 运行当前 TCL 脚本`**（`innovus-tcl.runScript`）
  - 运行当前编辑器中的完整 TCL 脚本
  - 工作目录自动设为脚本文件所在目录
  - 支持 `source` 命令的相对路径解析

### 内部改进
- `src/runner.ts`：新增 `TclRunner` 类，含 tclsh 查找、Innovus 命令检测、proc 包装器生成、进程管理
- `src/extension.ts`：新增输出通道 + `runScript` 命令注册
- `package.json`：新增 `innovus-tcl.runScript` 命令 + 版本提升至 0.5.0

## 0.4.3 (2026-07-08)

### 新增 — 递归 .f 文件解析（-F / -f 指令）
- **-F xxx.f**：递归解析 `xxx.f`，并**切换基准目录**到 `xxx.f` 所在目录
  - 例：`-F dir1/b.f` → `b.f` 中的 `b.v` 解析为 `proj/dir1/b.v`
- **-f xxx.f**：递归解析 `xxx.f`，但**保持调用者目录**作为基准
  - 例：`-f dir2/c.f` → `c.f` 中的 `c.v` 解析为 `proj/c.v`（不切换到 `dir2/`）
- **任意层级递归**：支持嵌套 `-F`/`-f` 指令任意深度
- **循环引用检测**：已访问的 `.f` 文件不会被重复解析

### 新增 — 动态设置 .f 文件路径命令
- **新命令**：`Innovus TCL: 📝 设置 .f 编译文件路径`
- **交互式输入**：输入框带当前值预览、路径校验（非空、.f 结尾）
- **自动重编译**：设置后自动重新运行 Lint 分析
- **工作区级别持久化**：配置写入 `.vscode/settings.json`
- **支持子目录路径**：`temp/a.f`、`subdir/proj.f` 等任意相对路径

### 内部改进
- `compiler.ts`：`parseFFile` 重构为 `parseFFileRecursive` 递归引擎
- `extension.ts`：新增 `setFFile` 命令注册
- `package.json`：新增 `innovus-tcl.setFFile` 命令声明

## 0.4.2 (2026-07-08)

### 新增 — Agent Skills 系统
- **自动安装 Agent Skill**：扩展激活时将 `.agents/skills/innovus-tcl-helper/` 同步到工作区
- **5 个 Skill 文件**：
  - `SKILL.md` — 入口 + 核心规则（防幻觉/MCP/Log/Lint）
  - `flow-guide.md` — 9 阶段 Innovus 设计流程参考（真实项目模式）
  - `tcl-basics.md` — TCL 编码规范 + **Log 文件输出规范**
  - `mcp-tools.md` — MCP 5 工具指南 + **强制防幻觉工作流**
  - `analysis-guide.md` — 脚本分析方法论
- **新命令**：`Innovus TCL: 🤖 安装 Agent Skill`（手动安装/更新 skill 文件）

### 新增 — Proc 跨文件定义跳转
- **F12 跳转到 proc 定义**：光标在 proc 调用名上按 F12，跳转到任意文件中该 proc 的定义位置

### 新增 — MCP 防幻觉强化
- **强制 MCP 查询工作流**：写任何 Innovus 命令前必须用 `innovus_get_command_help` 确认语法参数
- **Lint-before-deliver 规则**：写完脚本立即调用 `innovus_lint_tcl` 验证

### 新增 — Log 输出规范
- **文件输出优先**：所有运行结果、报告、错误信息必须输出到文件，禁止仅 puts 到终端
- **目录结构约定**：`$REPORT_DIR/stage_name/xxx.rpt`，自动检测并创建目录

### 改进 — MCP Server（v0.4.1 → v0.4.2）
- **Lint 工具拆分**：`innovus_lint_tcl`（快速摘要）+ `innovus_lint_tcl_detailed`（详细报告）
- **传文件路径省 token**：接受 `f_file_path` 或 `tcl_files[]`（文件绝对路径，非文件内容）
- **动态导入编译器**：使用 `import()` 动态加载 `out/compiler.js`，fallback 到内置 linter

### 改进 — LM Tools
- **Lint 工具重构**：`compileFromPaths()` 通用编译方法，支持 `.f` 文件路径和 `.tcl` 文件数组
- **临时目录编译**：仅提供 `.tcl` 文件时自动生成 `.f` 文件到临时目录

### 新增 — AI 提示词
- `prompts/cn/innovus-flow-guide.md` — Innovus 流程指引（中文）
- `prompts/cn/innovus-tcl-analysis.md` — TCL 脚本分析指引（中文）
- `prompts/cn/innovus-tcl-dev.md` — TCL 开发指引（中文）
- `prompts/en/innovus-tcl-dev.md` — TCL Development Guide（English）

### 内部改进
- `definition.ts`：重构 set 变量跳转逻辑 + 新增 proc 定义跳转
- `extension.ts`：新增 `installAgentSkills()` + `installSkills` 命令
- `tools.ts`：重构 Lint 工具，新增 `compileFromPaths()` 通用方法
- `scripts/mcp-server.mjs`：重写 Lint 工具输入输出流，版本提升至 v0.4.2
- 删除冗余 `scripts/generate_en_help 2.mjs`

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
