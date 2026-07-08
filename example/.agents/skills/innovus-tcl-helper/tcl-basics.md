# TCL 编码实战规范

基于真实 Innovus 项目总结的编码模式和惯用法。

## 变量命名

```tcl
# ✅ 全大写+下划线（全局变量）
set TOP_LAYER "M7"; set VDD_PIN "VDD"
set SCRIPTS_DIR [file dirname [info script]]

# ✅ 小写+下划线（局部计算变量）
set core_site_width 0.5; set macro_site_height 2.0

# ✅ ${VAR} 花括号明确边界
set NETLIST_FILE "$SCRIPTS_DIR/../../output/$VERSION/netlist.v"
set MMMC_FILE "$SCRIPTS_DIR/../input/$VERSION/mmmc/corner.mmmc"
```

## 常用模式

### 目录创建
```tcl
if {![file exist $DIR]} { exec mkdir -p $DIR }
```

### 流程开关
```tcl
set UPF_FLOW 0; set DEBUG 0
if {$UPF_FLOW} { ... }
```

### Mode 设置：先 reset
```tcl
setAddRingMode -reset
setAddRingMode -stacked_via_bottom_layer $BOT -stacked_via_top_layer $TOP
```

### expr 计算（必须在花括号内）
```tcl
set w [expr $core_site_width*10]
set spacing [expr $core_site_height*0.6]
```

### 列表操作
```tcl
list $VDD $VSS              # 创建列表
[list $VDD $VSS]            # 命令参数中的列表
lappend lines "  item"      # 追加
join $lines " \\\n"         # 连接
lsort -unique $list         # 去重排序
```

### Proc 定义（含默认值）
```tcl
proc name { arg1 arg2 {arg3 "default"} } { ... }
```

### foreach + lappend + join（构建字符串块）
```tcl
set lines {}
foreach lib $LIBS {
    lappend lines "    {[list $lib]}"
}
set block [join $lines " \\\n"]
```

### 文件 I/O
```tcl
set fp [open $file r]; set data [read $fp]; close $fp
set fp [open $file w]; puts $fp $data; close $fp
```

### 模板替换
```tcl
set result [subst -nocommands -nobackslashes $template]
```

### for 循环（步进2取元素）
```tcl
for {set x 3} {$x < $len} {set x [expr {$x+2}]} {
    lappend names [lindex $arr $x]
}
```

## Innovus 特有约定

### 隐式变量（init_design 自动读取）
```tcl
set init_verilog "netlist.v"; set init_top_cell "top"
set init_pwr_net "VDD"; set init_gnd_net "VSS"
set init_lef_file "$TECH_LEF $CELL_LEF"
set init_mmmc_file ${MMMC_FILE}
```

### 行续（反斜杠）
```tcl
addRing -center 1 \
    -nets [list $VDD $VSS] \
    -type core_rings
```

### 注释风格
```tcl
#------------------------------------
# Section Title
#------------------------------------
```

## 常见问题
- **变量冒号**：`$BOTTOM_LAYER:$TOP_LAYER` → 用 `${BOTTOM_LAYER}:${TOP_LAYER}`
- **Proc 参数**：不是未定义变量，是自动可用的参数
- **循环变量**：foreach/for 自动定义，无需 set
- **report 输出**：`> $DIR/file.rpt` 或 `-outDir $DIR -prefix name`

## Log 输出规范 ⚠️ 重要

### 原则：不要只 puts 到终端

所有运行结果、报告、错误信息必须输出到 **文件**，同时可以 puts 到终端用于实时监控。

### 目录创建 + 文件输出模式
```tcl
# 1. 确保日志目录存在
if {![file exist ${REPORT_DIR}/stage_name]} {
    exec mkdir -p ${REPORT_DIR}/stage_name
}

# 2. 输出到文件（用 > 重定向或 -outDir/-file 参数）
verify_drc > $REPORT_DIR/verify/verify_drc.rpt
report_timing -unconstrained -delay_limit 20 > $REPORT_DIR/timing.rpt
optDesign -preCTS -outDir $REPORT_DIR/opt -prefix prects
```

### 自定义 Log 输出
```tcl
# 打开 log 文件写入
set log_file [open "$REPORT_DIR/stage_name/run.log" w]
puts $log_file "[clock format [clock seconds]] 开始执行..."
puts $log_file "TOP_LAYER = $TOP_LAYER"
# ... 执行操作 ...
puts $log_file "[clock format [clock seconds]] 执行完成"
close $log_file
```

### 错误处理和 Log
```tcl
if {[catch {some_command} err_msg]} {
    set err_fp [open "$REPORT_DIR/errors.log" a]
    puts $err_fp "[clock format [clock seconds]] ERROR: $err_msg"
    close $err_fp
    error $err_msg
}
```

### 目录结构约定
```
$REPORT_DIR/
├── placement_phase/
│   └── EndCap.rpt
├── CTS/
│   ├── clock_trees.rpt
│   └── skew_groups.rpt
├── route/
│   └── postRoute_time/
├── verify/
│   ├── verify_drc
│   └── verifyConnectivity
└── summary_3dims/
    ├── timing/
    └── power/
```
