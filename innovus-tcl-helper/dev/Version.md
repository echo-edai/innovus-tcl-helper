0.2 ✅ 增强自动补全（参数类型提示 + 占位符 + 枚举选项），增加自定义跳转（F12/Ctrl+Click → 虚拟帮助文档），必选参数缺失诊断（精确解析参数行）

0.3 ✅ 支持切换 Innovus 版本（多版本数据目录扫描 + 快速切换）。TCL 代码静态检查增强（三级检查：basic/standard/strict，含相似命令建议、重复参数检测、参数类型验证）。Copilot AI 集成（3 个 LM Tools：innovus_list_commands / innovus_get_command_help / innovus_parse_tcl_script）。TCL 脚本 AI 分析命令（Ctrl+Shift+P → "AI 分析当前 TCL 脚本"，生成 Markdown 报告）。

0.4 支持 TCL 脚本编译分析，支持通过 .f 文件（默认是tcl.f文件，可以命令配置是哪个.f文件）传入所有的TCL要读取的脚本和读取顺序，支持跨文档查看变量内容。比如第一个 TCL 脚本中 set a=1，根据 .f 编译后在第 3 个 TCL 脚本中悬浮在 a 上可以看到 a 是 1

这个难度可能较大，你要一步步分析，每次有一个进展就要存一下git。要求完成一个完整的可用的无bug的lint工具，并且暴露lint接口给ai的mcp使用

0.5 可以 TCL 脚本拼接后 AI 解析，生成上下文更加相关的 TCL 脚本描述
