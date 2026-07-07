# 调试指南与调试数据

## 调试环境准备

### 1. 确认项目结构完整

如何将其在本地调试？你自己终端能否运行一下测试测试。还有一些是变量配置的，比如set check_design_across_hierarchy，这个会修改变量并影响设计

增加自动补全功能，增加自定义跳转，可以将命令跳转到详细的man/help的docs界面。是否支持

```bash
cd innovus-tcl-helper
ls -la

# 必须存在:
#   package.json
#   tsconfig.json
#   src/extension.ts
#   src/commands.ts
#   src/hover.ts
#   src/completion.ts
#   src/diagnostics.ts
#   out/  (编译后)
#   ../data_base/help/deepseek-chat/  (数据目录)
```

### 2. 确认编译通过

```bash
npm run compile
# 无错误输出即表示成功
```

### 3. 确认数据可加载

```bash
node -e "
const path = require('path');
const fs = require('fs');
const dir = path.join(__dirname, '..', 'data_base', 'help', 'deepseek-chat');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
console.log('数据文件数:', files.length);
const first = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'));
console.log('示例命令:', first.command);
console.log('摘要:', first.summary);
"
```

预期输出：

```
数据文件数: 2175
示例命令: Puts
摘要: 打印指定变量或命令的帮助信息
```

## 调试配置

### VS Code launch.json

创建 `.vscode/launch.json`（此目录和文件不发布）：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": [
        "${workspaceFolder}/out/**/*.js"
      ],
      "preLaunchTask": "npm: compile"
    },
    {
      "name": "Extension Tests",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "--extensionTestsPath=${workspaceFolder}/out/test/suite/index"
      ],
      "outFiles": [
        "${workspaceFolder}/out/**/*.js"
      ],
      "preLaunchTask": "npm: compile"
    }
  ]
}
```

### VS Code tasks.json

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "compile",
      "group": {
        "kind": "build",
        "isDefault": true
      },
      "label": "npm: compile",
      "problemMatcher": "$tsc"
    },
    {
      "type": "npm",
      "script": "watch",
      "group": "build",
      "label": "npm: watch",
      "problemMatcher": "$tsc",
      "isBackground": true
    }
  ]
}
```

## 调试步骤

### Step 1: 设置断点

在以下关键位置设置断点：

| 文件               | 行                           | 说明         |
| ------------------ | ---------------------------- | ------------ |
| `extension.ts`   | `activate()` 函数          | 插件激活入口 |
| `commands.ts`    | `load()` 方法              | 命令数据加载 |
| `hover.ts`       | `provideHover()`           | 悬停触发     |
| `completion.ts`  | `provideCompletionItems()` | 补全触发     |
| `diagnostics.ts` | `updateDiagnostics()`      | 诊断触发     |

### Step 2: 启动调试

按 `F5` → 选择 "Run Extension"

### Step 3: 测试各项功能

在 Extension Development Host 窗口中：

1. 打开 `test/example.tcl`（或创建新的 .tcl 文件）
2. 输入 `addInst` → **验证补全**：应弹出命令名列表
3. 输入 `addInst -` → **验证参数补全**：应显示 `-cell`, `-inst` 等
4. 鼠标悬浮在 `addInst` 上 → **验证悬停**：应显示中文帮助
5. 输入 `set x [expr {1 + 2]]` → **验证诊断**：保存文件后应报 "多余的右方括号"
6. 输入 `addInst`（不加必需参数） → **验证参数警告**：应提示缺少 `-cell` 和 `-inst`

### Step 4: 查看日志

在 Extension Development Host 中：

- `Help → Toggle Developer Tools` → Console 标签页
- 查找 `[Innovus TCL]` 前缀的日志

## 调试数据

### test/example.tcl — 功能验证

```tcl
# === 命令补全测试 ===
# 输入 "add" 时应在补全列表中看到 addInst, addNet 等

# === 悬停提示测试 ===
# 鼠标悬浮在以下命令上验证：
addInst -cell AND2X1 -inst my_and1 -loc {100 200} -ori R0 -place_status placed
addNet -net my_net -pins {my_and1/A my_or1/Y}

# === 参数补全测试 ===
# 在以下命令行末输入 " -" 验证参数提示：
checkDesign -all

# === 诊断测试 ===
# 以下行保存后应有错误/警告：

# 括号错误：
set x [expr {1 + 2]]

# 引号错误：
puts "hello world

# 缺少必需参数（addInst 需要 -cell 和 -inst）：
# addInst

# === 正常用法（不应报错） ===
report_timing -delay_type max -nworst 10
setPlaceMode -congEffort high
routeDesign -globalDetail
verify_drc
saveDesign my_design.enc
```

### 功能验证清单

| 测试项               | 预期行为               | 通过 |
| -------------------- | ---------------------- | ---- |
| 打开 .tcl 文件       | 插件自动激活           | ☐   |
| 输入命令名前缀       | 弹出补全列表           | ☐   |
| 选择补全项           | 插入命令名             | ☐   |
| 命令后输入 -         | 弹出参数补全           | ☐   |
| 已用 flag 不再提示   | 二次输入时不显示       | ☐   |
| 鼠标悬浮命令名       | 显示中文 Markdown 文档 | ☐   |
| 保存含语法错误的文件 | 显示红色波浪线         | ☐   |
| 保存含参数警告的文件 | 显示黄色波浪线         | ☐   |
| 执行重载命令         | 提示 "已重新加载"      | ☐   |
| 执行信息命令         | 显示 Modal 面板        | ☐   |
| 关闭 .tcl 文件       | 插件不报错             | ☐   |

## 常见调试问题

### Q: 补全列表为空

- 检查数据目录 `../data_base/help/deepseek-chat/` 是否存在
- 查看 Developer Tools Console 是否有加载错误

### Q: 悬停不显示

- 确认 `innovus-tcl.enableHover` 为 `true`
- 确认单词完全匹配 JSON 中的 `command` 字段（大小写敏感）

### Q: 诊断不触发

- 诊断仅在**保存文件时**触发（`onDidSaveTextDocument`）
- 切换编辑器时也会触发
- 确认 `innovus-tcl.enableDiagnostics` 为 `true`

### Q: 修改源码后不生效

- 重新编译：`npm run compile`
- 重新启动调试：`Ctrl+Shift+F5`（Restart Debugging）
- 或使用 watch 模式：`npm run watch`
