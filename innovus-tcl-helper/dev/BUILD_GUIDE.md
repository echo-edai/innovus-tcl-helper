# 构建、测试与发布指南

## 项目结构概览

```
vscode-plugins/                    ← Git 仓库根目录 ✅
├── .gitignore                     # 忽略 node_modules, out/, data/, *.vsix
├── data_base/                     # ✅ 开源数据，Git 管理
│   ├── all_cmds.json
│   ├── cn/help/  (2175 JSON)     # 中文命令文档
│   ├── cn/man/   (2178 JSON)
│   ├── en/help/  (2192 JSON)     # 英文命令文档
│   ├── en/man/   (2192 JSON)
│   ├── en/ori_logs/help_logs/    # 原始英文 .log（源数据）
│   └── sort_cmds_jsons/
│
└── innovus-tcl-helper/            ← VS Code 扩展
    ├── package.json
    ├── tsconfig.json
    ├── .vscodeignore              # VSIX 打包排除规则
    ├── .vscode/
    │   ├── launch.json            # F5 调试配置 ✅
    │   └── tasks.json             # 编译任务 ✅
    ├── src/                       # TypeScript 源码
    ├── scripts/
    │   ├── prepublish.mjs         # 打包前复制 data_base → data/
    │   └── generate_en_help.mjs   # 英文 .log → JSON 生成器
    ├── docs/                      # 用户文档（随 VSIX 发布）
    └── dev/                       # 开发文档（不发布）
```

## 一、直接在项目中开发/调试

### 1.1 打开项目

用 VS Code 打开 **`vscode-plugins/`**（仓库根目录）或 **`innovus-tcl-helper/`** 均可。

> 推荐打开 `vscode-plugins/`，这样可以同时查看 data_base 和扩展源码。

### 1.2 安装依赖

```bash
cd innovus-tcl-helper
npm install
```

### 1.3 编译

```bash
npm run compile      # 一次性编译
# 或
npm run watch        # 监视模式，改代码自动编译
```

### 1.4 启动调试（F5）

1. 在 VS Code 中打开 `innovus-tcl-helper/` 文件夹
2. 按 **`F5`**（自动编译 + 启动 Extension Development Host）
3. 弹出的新窗口中，打开任意 `.tcl` 文件
4. 在源码中设断点，调试各项功能

> `.vscode/launch.json` 和 `.vscode/tasks.json` 已配置好，开箱即用。

### 1.5 数据路径说明

| 场景 | data_base 位置 | commands.ts 自动查找 |
|------|---------------|---------------------|
| 开发调试 | `vscode-plugins/data_base/` | `extensionPath/../data_base/` ✅ |
| VSIX 安装后 | 内置 `data/` | `extensionPath/data/` ✅ |
| 自定义路径 | 用户指定 | `innovus-tcl.dataRoot` 配置 |

## 二、测试清单

在 Extension Development Host 中打开 `.tcl` 文件，逐一验证：

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 1 | 命令名补全 | 输入 `addI` | 弹出 `addInst` 等补全列表 |
| 2 | 参数补全 | 输入 `addInst -` | 弹出 `-cell`、`-inst` 等参数 |
| 3 | 悬停提示（中文） | 鼠标悬浮 `addInst` | 显示中文 Markdown 文档 |
| 4 | 切换英文 | 设置 `innovus-tcl.language` = `en` | 悬停变为英文 |
| 5 | 括号错误 | 输入 `set x [expr {1]]` | 保存后标红 "多余的 ]" |
| 6 | 引号错误 | 输入 `puts "hello` | 保存后标红 "未闭合引号" |
| 7 | 缺少参数 | 只输入 `addInst` | 保存后标黄 "缺少必需参数" |

## 三、打包 VSIX

### 3.1 安装打包工具

```bash
npm install -g @vscode/vsce
```

### 3.2 一键打包

```bash
cd innovus-tcl-helper
npm run package
```

这条命令会自动：
1. 运行 `scripts/prepublish.mjs` → 从 `../data_base/` 复制 JSON 到 `data/`
2. 运行 `tsc -p ./` → 编译 TypeScript
3. 运行 `vsce package` → 生成 `.vsix`

输出：`innovus-tcl-helper-0.1.0.vsix`

### 3.3 VSIX 内包含什么

```
innovus-tcl-helper-0.1.0.vsix
├── extension/
│   ├── package.json
│   ├── out/                     # 编译后的 JS
│   ├── data/                    # 内置命令数据 (cn/help/ + en/help/)
│   │   ├── cn/help/*.json       # 中文
│   │   └── en/help/*.json       # 英文
│   └── docs/                    # README, CHANGELOG
```

> **不包含**：`src/`、`dev/`、`test/`、`scripts/`、`node_modules/`、原始 `.log` 文件

### 3.4 安装 VSIX

```bash
code --install-extension innovus-tcl-helper-0.1.0.vsix
```

或在 VS Code 中：`Cmd+Shift+P` → `Extensions: Install from VSIX...`

## 四、发布到 VS Code Marketplace

### 4.1 创建发布者账号

1. 访问 https://marketplace.visualstudio.com/manage
2. 用 Microsoft 账号登录
3. 创建 publisher（如 `echoro`）

### 4.2 获取 Personal Access Token

1. https://dev.azure.com → 你的组织 → User Settings → Personal Access Tokens
2. 创建 token，权限勾选 **Marketplace (publish)**
3. 复制 token

### 4.3 发布

```bash
cd innovus-tcl-helper

# 登录
vsce login echoro

# 发布（补丁版本号自动 +1）
vsce publish patch

# 或指定版本
vsce publish 0.1.0
```

## 五、Git 管理

### 5.1 当前仓库结构

```
vscode-plugins/          ← Git 仓库
├── .gitignore           # 排除 node_modules, out/, data/, *.vsix
├── data_base/           # ✅ 纳入版本管理（开源数据）
└── innovus-tcl-helper/  # ✅ 纳入版本管理（插件源码）
```

### 5.2 Git 工作流

```bash
# 开发新功能
git checkout -b feature/xxx
# ... 修改代码 ...
git add -A && git commit -m "feat: xxx"

# 发布前
npm run compile          # 确保编译通过
git tag v0.1.0           # 打版本标签
git push origin main --tags
```

### 5.3 data_base 是否需要同步发布？

**不需要单独发布 data_base。** VSIX 打包时 `prepublish.mjs` 会自动将所需 JSON 复制到扩展内，最终用户只需安装 `.vsix` 即可。

data_base 保留在 Git 仓库中的好处：
- 开源可见，他人可审核命令数据质量
- 英文 .log 是生成的源数据，新版 Innovus 可重新导出
- 方便社区贡献（修正翻译、补充命令等）

## 六、更新数据

当 Innovus 版本升级时：

```bash
# 1. 导出新版 help 输出
# (在 Innovus 中批量执行 help <cmd>，保存到 en/ori_logs/help_logs/)

# 2. 重新生成英文 JSON
node scripts/generate_en_help.mjs

# 3. 如果要更新中文翻译，用 DeepSeek 等大模型重新处理

# 4. 重新打包
npm run package
```

## 七、NPM Scripts 速查

| Script | 用途 |
|--------|------|
| `npm run compile` | 编译 TypeScript → `out/` |
| `npm run watch` | 监视编译 |
| `npm run prepublish` | 复制 data_base JSON → `data/` |
| `npm run package` | prepublish + compile + vsce package |
| `npm run lint` | ESLint 检查 |
