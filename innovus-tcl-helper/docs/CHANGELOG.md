# 更新日志

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
