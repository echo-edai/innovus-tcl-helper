# Flow Guide — Innovus 设计流程实战参考

基于真实项目 13 个脚本的精炼。所有代码片段来自实际运行脚本。

## 目录创建模式（贯穿所有阶段）
```tcl
if {![file exist ${REPORT_DIR}/stage]} {
    exec mkdir -p ${REPORT_DIR}/stage
}
```

## 阶段 0：环境变量 (0_setenv.tcl)

```tcl
# 脚本自身目录
set SCRIPTS_DIR [file dirname [info script]]
# 层定义
set TOP_LAYER "M7"; set BOTTOM_LAYER "M1"
# ${VAR} 明确变量边界
set NETLIST_FILE "$SCRIPTS_DIR/../../DC/output/$VERSION/syn_netlist/top_$VERSION.v"
# 列表
set TIMING_LIBS [list "$LIB_FILE"]
# 流程开关
set UPF_FLOW 0; set GENERATE_MMMC 0
```

### 模板生成（subst）
```tcl
set fp [open $TPL r]; set tpl [read $fp]; close $fp
set result [subst -nocommands -nobackslashes $tpl]
```

## 阶段 0_cmd：自定义 Procs
```tcl
proc name { arg1 {arg2 "default"} } { ... }
# foreach + lappend + join
foreach lib $LIBS { lappend lines "  {[list $lib]}" }
set block [join $lines " \\\n"]
```

## 阶段 0_eco：ECO 修复
```tcl
for {set x 3} {$x<$n} {set x [expr {$x+2}]} { lappend names [lindex $arr $x] }
lsort -unique $names
# 针对性布线
setNanoRouteMode -routeSelectedNetOnly true; globalDetailRoute
```

## 阶段 1：初始化 (1_init.tcl)
```tcl
setMultiCpuUsage -localCpu 10
setPreference EnableRectilinearDesign 1
set_table_style -no_frame_fix_width -nosplit -name report_timing
# UPF
read_power_intent -1801 dc.upf; commit_power_intent
```

## 阶段 2：布图 (2_floorplan.tcl)
```tcl
floorPlan -site $CORE_SITE -b 0 0 [expr $w*...] [expr $h*...] ...
set core_box [list $x1 $y1 $x2 $y2]
setObjFPlanBox Group NAME x1 y1 x2 y2  ;# UPF
```

## 阶段 3：电源 (3_powerplan.tcl)

### addRing
```tcl
setAddRingMode -reset
setAddRingMode -stacked_via_bottom_layer $BOTTOM_LAYER -stacked_via_top_layer $TOP_LAYER
addRing -center 1 -nets [list $VDD $VSS] -type core_rings \
    -layer [list top $TOP bottom $BOT left $L3 right $L3] \
    -width [expr $w*10] -spacing [expr $w*5] -offset [expr $w*20]
```

### addStripe
```tcl
addStripe -nets [list $VDD $VSS] -layer M7 -direction horizontal \
    -width [expr $h*0.8] -spacing [expr $h*0.6] \
    -set_to_set_distance [expr $h*18] -start_from bottom
```

### globalNetConnect（4种）
```tcl
globalNetConnect $VDD -type pgpin -pin $VDD -inst * -override
globalNetConnect $VDD -type tiehi -pin $VDD -inst * -override
```

### sroute
```tcl
sroute -connect { blockPin corePin } -nets [list $VDD $VSS] \
    -blockPin useLef -allowJogging 1 -allowLayerChange 1
```

## 阶段 4：布局 (4_placement.tcl)
```tcl
setEndCapMode -reset
setEndCapMode -topEdge $CELL -bottomEdge $CELL -prefix ENDCAP -create_rows true
addEndCap; verifyEndCap -report $DIR/EndCap.rpt
set_well_tap_mode -inRowOffset [expr $w*45]
addWellTap -cell $CELL -cellinterval [expr $w*45] -prefix WELLTAP
```

## 阶段 5：优化 (5_opt.tcl)
```tcl
setDelayCalMode -siAware false
setAnalysisMode -analysisType onChipVariation
setOptMode -fixFanoutLoad true
setTieHiLoMode -maxFanOut 10 -cell [list $LO $HI]
addTieHiLo -cell [list $LO $HI] -prefix TIE
optDesign -preCTS -outDir $DIR/opt -prefix prects
check_timing -verbose > $DIR/opt/check_timing.rpt
```

## 阶段 6：CTS (6_CTS.tcl)
```tcl
add_ndr -name $LEAF_RULE -spacing_multiplier [list $B:$T $S] -width_multiplier [list $B:$T $W]
create_route_type -name leaf_rule -non_default_rule $LEAF_RULE -bottom_preferred_layer M6 -top_preferred_layer M7
set_ccopt_property -net_type leaf -route_type leaf_rule
set_ccopt_property -net_type trunk target_max_trans [expr 0.1*$PERIOD]
create_ccopt_skew_group -name ref_clk -source $CLK -auto_sinks
create_ccopt_clock_tree_spec -file $DIR/cts.spec -immediate
source $DIR/cts.spec
set_ccopt_effort -high; clock_opt_design -cts
optDesign -postCTS -hold -outDir $DIR/CTS -prefix postCTS_hold
```

## 阶段 7：布线 (7_route.tcl)
```tcl
setNanoRouteMode -drouteUseMultiCutViaEffort high
setNanoRouteMode -drouteFixAntenna true -routeAntennaCellName ANTENNA
setNanoRouteMode -droutePostRouteSpreadWire true -droutePostRouteWidenWire true
setNanoRouteMode -routeWithOpt true
setRouteMode -earlyGlobalMaxRouteLayer $TOP -earlyGlobalMinRouteLayer $BOT
earlyGlobalRoute; routeDesign
setAnalysisMode -analysisType onChipVariation -cppr both
optDesign -postRoute -setup; optDesign -postRoute -hold
```

## 阶段 8-10：验证报告输出
```tcl
verify_drc > $DIR/verify_drc; verifyConnectivity > $DIR/verifyConn
set_default_switching_activity -input_activity 0.2 -seq_activity 0.2
propagate_activity; write_tcf $DIR/test.tcf

report_power -rail_analysis_format VS -net -format detailed -outfile $DIR/power.rpt
report_timing -unconstrained -delay_limit 20 > $DIR/timing.rpt

defOut -floorplan -netlist -routing $OUT/DEF/top.def.gz
rcOut -spef $OUT/SPEF/worst.spef
write_sdf -view setup_view -ideal_clock_network $OUT/SDF/setup.sdf
saveNetlist -excludeLeafCell -includePowerGround $OUT/NETLIST/netlist.v
```

## 速查表
| 需求 | 命令 |
|------|------|
| 电源环 | `addRing -type core_rings` |
| 电源条纹 | `addStripe -direction horizontal/vertical` |
| 全局网络 | `globalNetConnect -type pgpin/tiehi/tielo` |
| 端帽 | `setEndCapMode`+`addEndCap` |
| NDR | `add_ndr`+`create_route_type` |
| CTS | `clock_opt_design -cts` |
| 布线 | `routeDesign` |
| 优化 | `optDesign -preCTS/-postCTS/-postRoute` |
| DRC | `verify_drc` |
| 时序 | `report_timing -unconstrained` |
| 功耗 | `report_power` |
| 导出 DEF | `defOut` |
| 导出 SPEF | `rcOut -spef` |
| 导出 SDF | `write_sdf` |
