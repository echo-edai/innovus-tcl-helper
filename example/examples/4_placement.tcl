#=============================================================================
# 阶段 4：标准单元放置 (Placement)
# 说明：添加端帽(endcap)和阱接触(welltap)，执行标准单元放置。
#=============================================================================

cus_report_separator "阶段 4: 标准单元放置"

cus_ensure_dir "${REPORT_DIR}/placement"

#--------------
# 端帽单元 (End Cap)
# 在每行标准单元两端添加，防止制造过程中的边缘效应
#--------------
setEndCapMode -reset
deleteFiller -prefix ENDCAP

setEndCapMode \
    -topEdge           $ENDCAP_CELL \
    -bottomEdge        $ENDCAP_CELL \
    -leftEdge          $ENDCAP_CELL \
    -rightEdge         $ENDCAP_CELL \
    -leftTopCorner     $ENDCAP_CELL \
    -rightBottomCorner $ENDCAP_CELL \
    -leftTopEdge       $ENDCAP_CELL \
    -leftBottomEdge    $ENDCAP_CELL \
    -rightTopEdge      $ENDCAP_CELL \
    -rightBottomEdge   $ENDCAP_CELL \
    -prefix ENDCAP \
    -create_rows true

addEndCap
verifyEndCap -report $REPORT_DIR/placement/EndCap.rpt

#--------------
# 阱接触单元 (Well Tap)
# 在标准单元行中按固定间距插入，防止闩锁效应(latch-up)
#--------------
set_well_tap_mode -reset
deleteFiller -prefix WELLTAP

set tap_interval [expr $core_site_width * 45]

if {$UPF_FLOW} {
    # UPF 模式：分别对每个电源域插入 well tap
    addWellTap -cell $WELLTAP_CELL \
        -cellinterval $tap_interval \
        -startRowNum 1 \
        -prefix WELLTAP
    # 为特定电源域单独添加
    # addWellTap -cell $WELLTAP_CELL -cellinterval $tap_interval \
    #     -startRowNum 1 -prefix WELLTAP -powerDomain <domain_name>
} else {
    # 普通模式：全局插入 well tap
    set_well_tap_mode -inRowOffset $tap_interval
    addWellTap -cell $WELLTAP_CELL \
        -cellinterval $tap_interval \
        -startRowNum 1 \
        -prefix WELLTAP
}

verifyWellTap -cell $WELLTAP_CELL \
    -rule $tap_interval \
    -report $REPORT_DIR/placement/WellTap.rpt

#--------------
# 标准单元放置
#--------------
setPlaceMode -placeIOPins 1
setPlaceMode -place_global_density 0.7       ;# 全局密度（70%）

place_design

#--------------
# 放置后检查
#--------------
checkPlace
timeDesign -preCTS -outDir $REPORT_DIR/placement

cus_save "4_placement"
puts "✅ 4_placement.tcl — 标准单元放置完成"
