# MCP 工具使用指南

## ⚠️ 强制规则：写 Innovus 命令前必须查询

**严禁凭记忆或经验编造 Innovus 命令名或参数名。** 每次写新命令前执行以下流程：

### 防幻觉工作流（必须遵守）
```
1. innovus_list_commands { search: "关键词" }  → 找到正确的命令名
2. innovus_get_command_help { command: "命令名" } → 确认语法、参数名、类型、必需性
3. 按文档的 options[].name 写参数名（一字不改）
4. 确认 required: true 的参数全部提供
5. 确认 enum 参数使用文档预设值
6. 写完脚本 → innovus_lint_tcl 验证
7. 有错误 → innovus_lint_tcl_detailed 深度分析 → 修复
```

### ❌ 严禁行为
- 凭记忆写命令名（如 "addInst" 写成 "addInstance"）
- 猜测参数名（必须与文档 options[].name 完全一致）
- 编造 enum 值（如 type 参数的合法值必须来自文档）
- 跳过 lint 直接交付代码

### ✅ 正确做法
```tcl
# 错误：凭记忆写（参数可能不对）
addRing -type core -width 10 -spacing 5

# 正确：先查 innovus_get_command_help，按文档写
addRing -center 1 \
    -nets [list $VDD $VSS] \
    -type core_rings \
    -layer [list top $TOP bottom $BOT left $L3 right $L3] \
    -width [expr $w*10] -spacing [expr $w*5]
```

## 5 个工具速查

| 工具 | 何时用 |
|------|--------|
| `innovus_list_commands` | 不知道命令名 → 搜索 |
| `innovus_get_command_help` | 知道命令名 → 查语法参数 |
| `innovus_parse_tcl_script` | 分析已有脚本 |
| `innovus_lint_tcl` | 写完代码 → 快速验证（极省 token） |
| `innovus_lint_tcl_detailed` | 有错误 → 深度追踪 |

## Lint 调用（传文件路径）
```json
{ "f_file_path": "/path/to/tcl.f" }
{ "tcl_files": ["/path/to/0_init.tcl"] }
```
