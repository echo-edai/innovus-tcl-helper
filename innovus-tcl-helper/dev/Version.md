0.2 ✅ 增强自动补全（参数类型提示 + 占位符 + 枚举选项），增加自定义跳转（F12/Ctrl+Click → 虚拟帮助文档），必选参数缺失诊断（精确解析参数行）

0.3 ✅ 支持切换 Innovus 版本（多版本数据目录扫描 + 快速切换）。TCL 代码静态检查增强（三级检查：basic/standard/strict，含相似命令建议、重复参数检测、参数类型验证）。Copilot AI 集成（3 个 LM Tools：innovus_list_commands / innovus_get_command_help / innovus_parse_tcl_script）。TCL 脚本 AI 分析命令（Ctrl+Shift+P → "AI 分析当前 TCL 脚本"，生成 Markdown 报告）。

0.4.3 ✅ 递归 .f 文件解析（-F / -f 指令，支持切换/保持目录、任意层级递归、循环引用检测）。动态设置 .f 文件路径命令（交互输入、路径校验、自动重编译、工作区级别持久化、支持子目录路径 temp/a.f）。

0.4.2 ✅ Agent Skills 系统（5 个 Skill 文件自动同步工作区、installSkills 命令）。MCP 防幻觉强化（强制 MCP 查询工作流、Lint-before-deliver）。Log 输出规范（文件输出优先、目录结构约定）。Proc 跨文件 F12 定义跳转（跨任意编译单元）。MCP Server Lint 工具拆分（`lint_tcl` 快速摘要 + `lint_tcl_detailed` 详细报告），传文件路径省 token。LM Tools 重构（`compileFromPaths()` 通用方法）。新增 4 个 AI 提示词文件（中英文）。

0.4 ✅ 跨文件 TCL 编译分析：.f 文件驱动的编译引擎（默认 tcl.f，可配置），按顺序编译所有 TCL 脚本；跨文件变量追踪（构建全局符号表）；悬浮 $varName/变量名显示值和定义位置；未定义变量/未使用变量诊断；文件保存时增量编译；.f 文件变化自动重编译；Lint 报告导出（Markdown/JSON）；MCP Server 暴露 lint 接口（innovus_lint_tcl_script 工具，支持跨文件变量追踪和错误检测）；新增 3 个 VS Code 命令（运行 Lint / 显示报告 / 打开 .f 文件）；新增 2 个配置项（enableCompilation / fFile）

这个难度可能较大，你要一步步分析，每次有一个进展就要存一下git。要求完成一个完整的可用的无bug的lint工具，并且暴露lint接口给ai的mcp使用

0.5.1 ✅ 跨平台 tclsh 支持（bin/<platform>/tclsh9.0 目录结构，运行时自动检测 os.platform()+os.arch()，darwin-arm64 已编译）。运行输出文件保存（runSaveOutput + runOutputDir 配置，时间戳 .log 文件含 stdout/stderr/Innovus 命令列表，自动创建输出目录）。.f 项目运行命令（runProject，预扫描统一包装器，逐文件编译顺序执行）。编辑器右上角运行按钮（▶️ 当前文件 + 📦 .f 项目）。

0.5 ✅ TCL 脚本运行引擎（基于 tclsh9.0，child_process 执行）。Innovus 命令智能拦截（自动检测 + 注入 proc 文档包装器，输出语法/参数说明而不报错）。标准 TCL 正常执行（set/puts/proc/expr 等）。专门输出通道 `Innovus TCL: Run`。自动查找 tclsh（Homebrew → 系统）。TCL 运行时错误捕获显示。新增 VS Code 命令 `innovus-tcl.runScript`。

0.4.3 ✅ 递归 .f 文件解析（-F / -f 指令，支持切换/保持目录、任意层级递归、循环引用检测）。动态设置 .f 文件路径命令（交互输入、路径校验、自动重编译、工作区级别持久化、支持子目录路径 temp/a.f）。



0.6 可以 TCL 脚本拼接后 AI 解析，生成上下文更加相关的 TCL 脚本描述。
