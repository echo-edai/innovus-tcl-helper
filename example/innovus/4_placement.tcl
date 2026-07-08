if {![file exist ${REPORT_DIR}/placement_phase]} {
    exec mkdir -p ${REPORT_DIR}/placement_phase
    echo "Creating ${REPORT_DIR}/placement_phase !!!"
}


# 重置端帽模式
setEndCapMode -reset

# 删除所有以 "ENDCAP" 开头的填充单元
deleteFiller -prefix ENDCAP

# 设置端帽模式（在边缘和角落添加端帽）
setEndCapMode \
    -topEdge $ENDCAP_CELL \
    -bottomEdge $ENDCAP_CELL \
    -leftEdge $ENDCAP_CELL \
    -rightEdge $ENDCAP_CELL \
    -leftTopCorner $ENDCAP_CELL \
    -rightBottomCorner $ENDCAP_CELL \
    -leftTopEdge $ENDCAP_CELL \
    -leftBottomEdge $ENDCAP_CELL \
    -rightTopEdge $ENDCAP_CELL \
    -rightBottomEdge $ENDCAP_CELL \
    -prefix ENDCAP \
    -create_rows true

# 添加端帽
addEndCap
# -area $core_box
# 验证端帽是否正确添加
verifyEndCap -report $REPORT_DIR/placement_phase/EndCap.rpt
# 重置阱接触模式
set_well_tap_mode -reset
# 删除所有以 "WELLTAP" 开头的填充单元
deleteFiller -prefix WELLTAP
# 设置阱接触模式（插入 WELLTAP 单元）
set_well_tap_mode -inRowOffset [expr $core_site_width*45]

addWellTap -cell $WELLTAP_CELL -cellinterval [expr $core_site_width*45] -startRowNum 1 \
    -prefix WELLTAP

if {$UPF_FLOW} {
    # 添加阱接触单元（FILL2）到指定电源域
    addWellTap -cell $WELLTAP_CELL -cellinterval [expr $core_site_width*45] -startRowNum 1 \
        -prefix WELLTAP

    addWellTap -cell $WELLTAP_CELL -cellinterval [expr $core_site_width*45] -startRowNum 1 \
        -prefix WELLTAP -powerDomain SW5t_v09

    addWellTap -cell $WELLTAP_CELL -cellinterval [expr $core_site_width*45] -startRowNum 1 \
        -prefix WELLTAP -powerDomain SW5r_v09
}


# 验证阱接触是否正确添加
verifyWellTap -cell $WELLTAP_CELL -rule [expr $core_site_width*45] -report $REPORT_DIR/placement_phase/WellCap.rpt

# 标准单元放置
setPlaceMode -placeIOPins 1

# 如果存在 I/O 文件，则加载它
if { $read_io_file == 1 } {
    setPlaceMode -placeIOPins 0 -fp false
    loadIoFile $IO_FILE
}

# 设置放置模式：全局连接努力为中等
setPlaceMode -place_global_cong_effort medium
# 执行标准单元放置与优化
place_opt_design
