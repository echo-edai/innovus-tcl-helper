#=============================================================================
# 阶段 8：物理验证 (Physical Verification)
# 说明：执行 DRC、连接性检查、天线效应检查、EM 检查等。
#=============================================================================

cus_report_separator "阶段 8: 物理验证"

cus_ensure_dir "${REPORT_DIR}/verify"

#--------------
# IO 文件保存
#--------------
if { $read_io_file == 0 } {
    saveIoFile -locations -temp $IO_FILE
    puts "✅ IO 文件已保存: $IO_FILE"
}

#--------------
# 连接性验证
#--------------
verify_connectivity -type all > $REPORT_DIR/verify/verify_connectivity.rpt
puts "✅ 连接性检查完成"

#--------------
# DRC (设计规则检查)
#--------------
verify_drc > $REPORT_DIR/verify/verify_drc.rpt
puts "✅ DRC 检查完成"

#--------------
# LVS 连接性验证
#--------------
verifyConnectivity > $REPORT_DIR/verify/verifyConnectivity.rpt
puts "✅ LVS 连接性检查完成"

#--------------
# 天线效应检查
#--------------
verifyWellAntenna > $REPORT_DIR/verify/verifyWellAntenna.rpt
puts "✅ 天线效应检查完成"

#--------------
# EM (电迁移) 检查
#--------------
verifyACLimit -use_db_freq -report $REPORT_DIR/verify/report_em.rpt
puts "✅ EM 检查完成"

#--------------
# 开关活动性传播（功耗分析前）
#--------------
set_default_switching_activity -reset
set_default_switching_activity -input_activity 0.2 -seq_activity 0.2
propagate_activity
write_tcf $REPORT_DIR/verify/activity.tcf

#--------------
# 保存最终设计
#--------------
cus_save "8_verify"
puts "✅ 8_verify.tcl — 物理验证完成"
