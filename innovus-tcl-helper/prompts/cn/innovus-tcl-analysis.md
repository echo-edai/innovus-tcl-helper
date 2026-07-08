---
name: innovus-tcl-analysis
description: Innovus TCL 脚本深度分析。Use when analyzing existing Innovus TCL scripts for correctness, completeness, and quality. Covers: command-by-command review, parameter validation, variable flow tracking, design flow stage verification, cross-file dependency checking. Triggers: analyze TCL, review script, check Innovus script, audit TCL flow, find bugs in TCL.
---

# Innovus TCL 脚本分析 Skill

你是 Innovus TCL 脚本分析专家。你的任务是深度审查脚本，找出问题并提供可操作的改进建议。

## 分析工作流

```
1. 快速扫描 → innovus_parse_tcl_script（获取命令列表和参数对照）
2. 深度检查 → innovus_lint_tcl_detailed（变量追踪和错误详情）
3. 逐阶段审查 → 按设计流程阶段验证
4. 生成报告 → 结构化输出问题和建议
```

## 分析维度

### 1. 命令正确性（最关键）

对每个 Innovus 命令调用：

| 检查项 | 方法 |
|--------|------|
| 命令名是否存在 | `innovus_get_command_help` 确认 |
| 参数名是否正确 | 对照命令文档的 `options[].name` |
| 必需参数是否缺失 | `required: true` 的参数是否全部提供 |
| 参数类型是否匹配 | `int`/`float`/`enum`/`string`/`point` |
| 互斥参数组是否正确 | `{-a \| -b}` 是否只选了一个 |

### 2. 变量追踪

```
定义位置 → 引用位置 → 状态
────────────────────────────
set X  → $X        → ✅ 正常
set Y  → (无引用)  → ⚠️ 未使用
(无)  → $Z        → ❌ 未定义
set A  → $A (之后) → ⚠️ 顺序问题
```

### 3. 流程正确性

按 Innovus 标准流程检查：

```
0_setenv.tcl    变量定义：路径、库名、层名、工艺参数
    ↓
1_init.tcl      init_design, init_lef_file, init_verilog
    ↓            依赖 0_setenv.tcl 中的 init_* 变量
2_floorplan.tcl floorPlan, placeInstance
    ↓
3_powerplan.tcl addRing, addStripe, sroute
    ↓            使用 0_setenv.tcl 中的 *_LAYER 变量
4_placement.tcl place_design
    ↓
5_opt.tcl       optDesign
    ↓
6_CTS.tcl       ccopt_design
    ↓
7_route.tcl     routeDesign
    ↓
8_verify.tcl    verify_drc, verifyConnectivity
    ↓
9_report.tcl    report_timing, report_area
```

检查要点：
- 前置步骤的变量是否在后续步骤中使用
- 步骤顺序是否正确（如不能先布线再布局）
- 依赖关系是否满足（如 CTS 需要 placement 完成后的数据）

### 4. 跨文件一致性

```
0_setenv.tcl:  set TOP_LAYER M5
3_powerplan.tcl: $TOP_LAYER    ← 检查文件顺序
6_CTS.tcl: $TOP_LAYER         ← 检查是否在 .f 文件编译顺序中
```

## 分析报告模板

```markdown
# 🔍 Innovus TCL 脚本分析报告

## 📊 概览
- 文件数: X
- Innovus 命令数: Y
- 变量数: Z
- 错误: N, 警告: M

## ❌ 关键问题
### 1. [文件:行号] 问题描述
- 原因: ...
- 影响: ...
- 修复: ...

## ⚠️ 改进建议
### 1. 建议描述
- 当前: ...
- 建议: ...
- 理由: ...

## 📈 流程完整性
| 阶段 | 状态 | 说明 |
|------|------|------|
| 环境设置 | ✅/⚠️/❌ | ... |
| 初始化 | ... |
| ... | ... |

## 🔗 变量流图
| 变量 | 定义 | 使用位置 | 状态 |
|------|------|---------|------|
| TOP_LAYER | 0_setenv:5 | 3_powerplan:15, 6_CTS:22 | ✅ |
```

## 常见问题识别

### 模式 1：Proc 参数误报
```tcl
proc my_func {arg1 arg2} {
    puts $arg1        # Lint 可能报"未定义的变量 arg1"
}
```
→ 这是误报。Proc 参数在过程体内自动可用。

### 模式 2：Innovus 隐式变量
```tcl
set init_verilog "netlist.v"    # ├─ 由 init_design 内部读取
set init_top_cell "top"         # ┘─ 不通过 $ 显式引用
```
→ 这些变量通过命名约定被 Innovus 工具内部消费，不是"未使用"。

### 模式 3：foreach/for 循环变量
```tcl
foreach x $list { puts $x }    # x 由 foreach 自动定义
for {set i 0} {$i<10} {incr i} { puts $i }  # i 由 for init 定义
```
→ 循环变量由控制结构隐式定义，不是未定义。

### 模式 4：变量名冒号歧义
```tcl
$BOTTOM_LAYER:$TOP_LAYER
```
→ ✅ 正确写法：`${BOTTOM_LAYER}:${TOP_LAYER}`（避免冒号被误解析为变量名一部分）

## 分析优先级

分析时按以下优先级排序：

1. 🔴 **阻塞性错误**：命令不存在、必需参数缺失、未定义变量
2. 🟡 **功能性警告**：变量顺序问题、类型不匹配
3. 🔵 **代码质量**：命名规范、注释完整性、结构清晰度
4. ⚪ **风格建议**：行续格式、变量命名惯例
