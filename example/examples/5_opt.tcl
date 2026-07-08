#=============================================================================
# 阶段 5：时序优化 (Pre-CTS Optimization)
# 说明：在时钟树综合之前进行时序优化，修复 setup/hold 违例。
#=============================================================================

cus_report_separator "阶段 5: Pre-CTS 时序优化"

cus_ensure_dir "${REPORT_DIR}/opt"

#--------------
# 设置优化模式
#--------------
setDelayCalMode -siAware false                ;# 关 SI 分析（Pre-CTS 阶段）
setAnalysisMode -analysisType onChipVariation ;# OCV 分析模式
setOptMode -fixFanoutLoad true               ;# 修复扇出负载
setOptMode -fixHoldAllowSetupTnsDegrade true  ;# 允许修 hold 时牺牲 setup

#--------------
# Tie-Hi / Tie-Lo 单元插入
#--------------
setTieHiLoMode -maxFanOut 10 \
    -cell [list $TIELO_CELL $TIEHI_CELL]

if {$UPF_FLOW} {
    # UPF 模式：按电源域分别插入
    # addTieHiLo -powerDomain <domain> -cell [list $TIELO_CELL $TIEHI_CELL] -prefix TIE
    setOptMode -resizeShifterAndIsoInsts true
} else {
    addTieHiLo -cell [list $TIELO_CELL $TIEHI_CELL] -prefix TIE
}

#--------------
# 执行 Pre-CTS 优化
#--------------
set_interactive_constraint_modes [all_constraint_modes -active]
setLimitedAccessFeature ediUsePreRouteGigaOpt 1

optDesign -preCTS -outDir $REPORT_DIR/opt -prefix prects

#--------------
# 优化后质量检查
#--------------
checkPlace
check_timing -verbose > $REPORT_DIR/opt/check_timing.rpt
report_timing -max_paths 100 > $REPORT_DIR/opt/timing_preCTS.rpt
report_timing -unconstrained -delay_limit 20 > $REPORT_DIR/opt/timing_unconstrained.rpt

timeDesign -preCTS -outDir $REPORT_DIR/opt/timeDesign_preCTS

if {$UPF_FLOW} {
    verifyPowerDomain -bind -gconn \
        -isoNetPD $REPORT_DIR/opt/isoNets.rpt \
        -xNetPD   $REPORT_DIR/opt/xNets.rpt
}

cus_save "5_opt_preCTS"
puts "✅ 5_opt.tcl — Pre-CTS 优化完成"
