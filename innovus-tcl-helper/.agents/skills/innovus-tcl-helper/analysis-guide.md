# 脚本分析指南

基于真实 Innovus 项目脚本的分析方法论。

## 分析工作流
```
innovus_lint_tcl → 快速扫描错误/警告分布
innovus_lint_tcl_detailed → 深度变量追踪+引用分析
innovus_parse_tcl_script → 命令参数逐个对照验证
逐阶段审查 → 按 0-9 标准流程验证逻辑
生成报告 → 结构化输出问题和建议
```

## 真实项目常见误报

### Proc 参数（不是未定义）
```tcl
proc cus_get_ports { port } { get_db [get_ports *] .name $port }
```
→ `port` 是 proc 参数，lint 可能误报。分析时需识别所有 proc 定义。

### foreach/for 循环变量
```tcl
foreach tmp [dbGet selected.] { puts $tmp }
for {set x 3} {$x<10} {incr x} { ... }
foreach lib $TIMING_LIBS { lappend lines $lib }
```
→ 由控制结构自动定义，不是未定义。

### Innovus 隐式变量（不是未使用）
```tcl
set init_verilog "netlist.v"     # init_design 内部读取
set init_top_cell "top"           # init_design 内部读取
set init_pwr_net "VDD"            # init_design 内部读取
set init_lef_file "..."           # init_design 内部读取
```
→ 通过命名约定被工具内部消费，不通过 `$` 显式引用。

### 变量冒号（不是新变量名）
```tcl
$BOTTOM_LAYER:$TOP_LAYER          # 冒号是分隔符，不是变量名部分
$BOTTOM_LAYER:$TOP_LAYER          # 写法不规范，建议 ${BOTTOM_LAYER}:${TOP_LAYER}
```

### gets/catch 隐式变量
```tcl
gets $fp line                      # line 由 gets 定义
catch {script} result              # result 由 catch 定义
```

## 真实项目模式检查

### 0_setenv.tcl 检查点
- 所有 LAYER 变量是否定义
- PIN 变量（VDD_PIN/VSS_PIN）是否定义
- 路径变量使用 `${VAR}` 花括号是否一致
- UPF_FLOW 开关是否覆盖所有条件分支

### 0_cmd.tcl 检查点
- proc 参数是否都有默认值或调用时传入
- foreach+lappend+join 模式是否正确
- open/close 是否配对

### 3_powerplan.tcl 检查点
- addRing 的 layer 列表是否与 0_setenv 定义的 LAYER 变量一致
- globalNetConnect 四种类型是否都配置
- sroute 的 layerChangeRange 是否匹配实际层

### 6_CTS.tcl 检查点
- NDR rule 的 layer 范围是否与 addRing 一致
- clock_opt_design 或 ccopt_design 是否在 optDesign -preCTS 之后
- source cts.spec 的路径是否匹配 create_ccopt_clock_tree_spec 的 -file 参数

## 分析优先级
1. 🔴 阻塞：命令不存在、必需参数缺失、未定义变量、文件不存在
2. 🟡 功能：变量顺序、类型不匹配、流程顺序
3. 🔵 质量：命名规范、注释完整性
4. ⚪ 风格：行续格式、变量惯例

## 输出要求
- **写脚本时**：设计方案 → 完整脚本 → 标注需确认的值 → Lint 验证 → 报告
- **分析脚本时**：Lint 快速扫描 → 深度分析 → 分阶段报告 → 标注问题和建议
