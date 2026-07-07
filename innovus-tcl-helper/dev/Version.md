0.2 ✅ 增强自动补全（参数类型提示 + 占位符 + 枚举选项），增加自定义跳转（F12/Ctrl+Click → 虚拟帮助文档），必选参数缺失诊断（精确解析参数行）

0.3 ✅ 支持切换 Innovus 版本（多版本数据目录扫描 + 快速切换）。TCL 代码静态检查增强（三级检查：basic/standard/strict，含相似命令建议、重复参数检测、参数类型验证）。Copilot AI 集成（3 个 LM Tools：innovus_list_commands / innovus_get_command_help / innovus_parse_tcl_script）。TCL 脚本 AI 分析命令（Ctrl+Shift+P → "AI 分析当前 TCL 脚本"，生成 Markdown 报告）。

0.4 ✅ 跨文件 TCL 编译分析：.f 文件驱动的编译引擎（默认 tcl.f，可配置），按顺序编译所有 TCL 脚本；跨文件变量追踪（构建全局符号表）；悬浮 $varName/变量名显示值和定义位置；未定义变量/未使用变量诊断；文件保存时增量编译；.f 文件变化自动重编译；Lint 报告导出（Markdown/JSON）；MCP Server 暴露 lint 接口（innovus_lint_tcl_script 工具，支持跨文件变量追踪和错误检测）；新增 3 个 VS Code 命令（运行 Lint / 显示报告 / 打开 .f 文件）；新增 2 个配置项（enableCompilation / fFile）

这个难度可能较大，你要一步步分析，每次有一个进展就要存一下git。要求完成一个完整的可用的无bug的lint工具，并且暴露lint接口给ai的mcp使用

0.5 可以 TCL 脚本拼接后 AI 解析，生成上下文更加相关的 TCL 脚本描述
