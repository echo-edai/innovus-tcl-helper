# 构建与打包指南

## 开发环境要求

- Node.js ≥ 18.x
- npm ≥ 9.x
- VS Code ≥ 1.85.0

## 项目初始化

```bash
cd innovus-tcl-helper

# 安装依赖（仅 devDependencies）
npm install

# 编译 TypeScript
npm run compile
```

编译输出到 `out/` 目录。

## VS Code 内调试

### 1. 创建调试配置

在项目根目录创建 `.vscode/launch.json`：

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
    }
  ]
}
```

以及 `.vscode/tasks.json`：

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "compile",
      "group": "build",
      "label": "npm: compile",
      "problemMatcher": "$tsc"
    }
  ]
}
```

### 2. 启动调试

1. 用 VS Code 打开 `innovus-tcl-helper/` 目录
2. 按 `F5`（或 Run → Start Debugging）
3. 弹出新的 VS Code 窗口（Extension Development Host）
4. 在新窗口中打开 `.tcl` 文件即可测试

### 3. 调试技巧

- 在原窗口的 `src/*.ts` 中设置断点
- `F5` 启动后，断点会自动生效
- 使用 Debug Console 查看 `console.log` 输出
- 查看 OUTPUT 面板中 "Innovus TCL" 频道的日志

### 4. 测试数据

`test/example.tcl` 包含了常用 Innovus 命令示例：

```tcl
# addInst -cell AND2X1 -inst my_and1 -loc {100 200} -ori R0 -place_status placed
# checkDesign -all
# report_timing -delay_type max -nworst 10
# setPlaceMode -congEffort high
# routeDesign -globalDetail
# verify_drc
```

## 打包发布

### 安装打包工具

```bash
npm install -g @vscode/vsce
```

### 生成 VSIX

```bash
cd innovus-tcl-helper

# 编译
npm run compile

# 打包
vsce package
```

输出：`innovus-tcl-helper-0.1.0.vsix`

### 打包注意事项

1. `.vscodeignore` 已排除 `src/`、`node_modules/`、`dev/` 等开发文件
2. `package.json` 中的 `main` 字段指向 `./out/extension.js`
3. 打包前务必执行 `npm run compile`

### 发布的 VSIX 包含内容

```
innovus-tcl-helper-0.1.0.vsix
├── extension/
│   ├── package.json
│   ├── out/                    # 编译后的 JS
│   │   ├── extension.js
│   │   ├── commands.js
│   │   ├── hover.js
│   │   ├── completion.js
│   │   └── diagnostics.js
│   └── docs/                   # 用户文档
│       ├── README.md
│       └── CHANGELOG.md
```

**不包含的**：`src/`、`node_modules/`、`dev/`、`test/`

### 安装 VSIX

```bash
# 方式 1: 命令行
code --install-extension innovus-tcl-helper-0.1.0.vsix

# 方式 2: VS Code 内
# Cmd+Shift+P → Extensions: Install from VSIX...
```

## NPM Scripts

| Script | 用途 |
|--------|------|
| `npm run compile` | 编译 TypeScript → JavaScript |
| `npm run watch` | 监视模式，文件变化自动编译 |
| `npm run lint` | ESLint 代码检查 |
| `npm run vscode:prepublish` | 打包前自动执行（= compile） |

## 常见问题

### Q: 编译报错 "Cannot find module 'vscode'"

```bash
npm install
```
确保 `node_modules/@types/vscode` 已安装。

### Q: 打包时提示缺少 publisher

编辑 `package.json` 中的 `publisher` 字段为你的发布者 ID。

### Q: 插件激活但数据未加载

检查数据目录路径是否正确。查看 VS Code 的 Developer Tools（Help → Toggle Developer Tools）中的 Console 日志。
