# Innovus TCL Helper

Cadence Innovus EDA 工具的 TCL 脚本辅助插件。为 `.tcl` 文件提供命令智能提示、悬停文档、跨文件编译分析和静态语法检查。

## 功能概览

| 功能 | 触发方式 | 说明 |
|------|----------|------|
| 🔍 **悬停文档** | 鼠标悬浮在命令名/变量名上 | 显示中文命令摘要、语法、参数表格；变量值及定义位置 |
| ✏️ **自动补全** | 输入命令名或 `-` 时 | 提示 Innovus 命令名及对应参数 |
| ⚠️ **静态检查** | 保存文件时 | 括号/引号匹配、命令必需参数校验 |
| 🔗 **跨文件编译** | 自动（基于 `.f` 文件） | 追踪变量定义与引用，跨文件显示变量值 |
| 📊 **Lint 报告** | `Cmd+Shift+P` → 显示 Lint 报告 | 导出 Markdown/JSON 格式的完整编译分析 |

## 快速开始 — 跨文件编译分析

1. 在工作区根目录创建 `tcl.f` 文件，每行写一个 `.tcl` 文件相对路径：
```
# tcl.f — TCL 脚本编译列表
0_cmd.tcl
1_init.tcl
2_floorplan.tcl
3_powerplan.tcl
```

2. 打开任意 `.tcl` 文件，插件自动按顺序编译所有脚本
3. 鼠标悬浮在 `$varName` 上查看变量值和定义位置
4. `Cmd+Shift+P` → `Innovus TCL: 📊 显示 Lint 报告` 查看完整分析

## 安装

### 从 VSIX 安装
```bash
code --install-extension publish/innovus-tcl-helper-0.1.0.vsix
```
或在 VS Code 中: `Cmd+Shift+P` → `Extensions: Install from VSIX...`

### 开发模式
```bash
git clone https://github.com/echo-edai/innovus-tcl-helper.git
cd innovus-tcl-helper
npm install
# 按 F5 启动扩展开发主机
```

## 发布

### 生成 VSIX（本地/离线分发）
```bash
npm run package
# → publish/innovus-tcl-helper-x.x.x.vsix
```

### 发布到 VS Code 商店

**首次设置:**
```bash
# 1. 获取 Personal Access Token
#    https://dev.azure.com → User Settings → Personal Access Tokens
#    权限: Marketplace > Acquire & Manage

# 2. 创建 publisher（仅一次）
npx vsce create-publisher fd-echoro

# 3. 登录
npx vsce login fd-echoro
# 粘贴上面获取的 PAT
```

**每次发布:**
```bash
# 1. 更新版本号 package.json "version": "x.y.z"
# 2. 运行
npm run publish
# 或 VS Code 内: Terminal → Run Task → 🚀 publish
```

## 配置

打开 VS Code 设置（`Cmd+,`），搜索 `innovus-tcl`：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `innovus-tcl.dataPath` | string | `""` | 命令 JSON 数据目录，留空则自动定位 |
| `innovus-tcl.enableHover` | boolean | `true` | 启用悬停提示 |
| `innovus-tcl.enableCompletion` | boolean | `true` | 启用自动补全 |
| `innovus-tcl.enableDiagnostics` | boolean | `true` | 启用单文件语法静态检查 |
| `innovus-tcl.enableCompilation` | boolean | `true` | 启用跨文件 TCL 编译分析 |
| `innovus-tcl.fFile` | string | `"tcl.f"` | `.f` 编译文件列表路径（相对工作区根目录） |
| `innovus-tcl.diagnosticLevel` | string | `"standard"` | 检查严格度: basic/standard/strict |

### 跨文件编译分析

在项目根目录创建 `tcl.f` 文件（或通过设置 `innovus-tcl.fFile` 自定义文件名），
每行一个 `.tcl` 文件相对路径，按从上到下的顺序编译：

```
# tcl.f — 示例
0_setenv.tcl
1_init.tcl
2_floorplan.tcl
3_powerplan.tcl
```

编译后：
- 鼠标悬停在 `$varName` 上显示变量值和定义位置
- 未定义变量会标记为错误
- `Cmd+Shift+P` → `Innovus TCL: 📊 显示 Lint 报告` 查看完整分析

### 自定义数据路径

默认情况下，插件从 `data_base/help/deepseek-chat/` 加载命令数据。
如果你的项目目录结构与默认不同，可在设置中指定：

```json
{
  "innovus-tcl.dataPath": "/path/to/your/data_base/help/deepseek-chat/"
}
```

## 使用演示

在 `.tcl` 文件中输入 Innovus 命令：

```tcl
# 悬停 addInst 查看中文文档
addInst -cell AND2X1 -inst my_and1 -loc {100 200} -ori R0

# 输入时自动补全命令名和参数
checkDesign -all

# 报告时序，输入 - 时自动提示参数
report_timing -delay_type max -nworst 10

# 语法错误会被标记（多余括号等）
setPlaceMode -congEffort high]]

# 缺少必需参数会有警告
routeDesign
```

## 命令

`Cmd+Shift+P` 打开命令面板：

- **Innovus TCL: 重新加载命令数据库** — 当外部 JSON 数据更新后重新加载
- **Innovus TCL: 显示插件信息** — 查看插件版本和加载状态

## 支持的命令数量

当前版本集成了 **2175** 个 Innovus 命令的中文文档，涵盖：
- 设计初始化 (`init_design`, `init_lef_file`, ...)
- 布局规划 (`floorPlan`, `place_design`, ...)
- 时钟树 (`ccopt_design`, `create_ccopt_clock_tree`, ...)
- 时序分析 (`report_timing`, `set_clock_latency`, ...)
- 电源网络 (`addStripe`, `sroute`, `addRing`, ...)
- 物理验证 (`verify_drc`, `verifyConnectivity`, ...)
- ... 等全部 Innovus 命令集

## 技术要求

- VS Code ≥ 1.85.0
- 无需额外运行时依赖（Node.js 内置于 VS Code）

## 许可证

MIT
