#=============================================================================
# 阶段 9：报告生成 (Report Generation)
# 说明：生成功耗、时序、面积等最终报告。
#=============================================================================

cus_report_separator "阶段 9: 报告生成"

#--------------
# 创建报告目录
#--------------
set REPORT_SUMMARY_DIR "${REPORT_DIR}/summary"
cus_ensure_dir "${REPORT_SUMMARY_DIR}/power"
cus_ensure_dir "${REPORT_SUMMARY_DIR}/timing"
cus_ensure_dir "${REPORT_SUMMARY_DIR}/area"

#=============================================================================
# 1. 功耗报告
#=============================================================================
cus_report_separator "功耗分析"

set_power_analysis_mode -reset
set_power_analysis_mode -method static \
    -analysis_view setup_view \
    -corner max \
    -create_binary_db true \
    -write_static_currents true \
    -honor_negative_energy true \
    -ignore_control_signals true

set_power_output_dir -reset
set_power_output_dir $REPORT_SUMMARY_DIR/power

set_default_switching_activity -reset
set_default_switching_activity -input_activity 0.2 -period 10.0

read_activity_file -reset
set_power -reset
set_powerup_analysis -reset
set_dynamic_power_simulation -reset

report_power -rail_analysis_format VS -net \
    -format detailed \
    -outfile $REPORT_SUMMARY_DIR/power/power_detail.rpt \
    -output $REPORT_SUMMARY_DIR/power

puts "✅ 功耗报告已生成"

#=============================================================================
# 2. 时序报告
#=============================================================================
cus_report_separator "时序分析"

# 违例汇总
report_constraint -all_violators > $REPORT_SUMMARY_DIR/timing/violations.rpt

# 时钟树报告
report_ccopt_clock_trees -file $REPORT_SUMMARY_DIR/timing/clock_trees.rpt
report_ccopt_skew_groups -file $REPORT_SUMMARY_DIR/timing/skew_groups.rpt

# 时序报告（最差 500 条路径）
report_timing -max_paths 500 > $REPORT_SUMMARY_DIR/timing/timing_worst500.rpt
report_timing -unconstrained -delay_limit 20 > $REPORT_SUMMARY_DIR/timing/timing_unconstrained.rpt

# 按 clock group 分别报告
# report_timing -max_paths 100 -path_type full_clock_expanded \
#     -group <clock_group> > $REPORT_SUMMARY_DIR/timing/timing_clk1.rpt

puts "✅ 时序报告已生成"

#=============================================================================
# 3. 面积报告
#=============================================================================
cus_report_separator "面积分析"

report_area -detail > $REPORT_SUMMARY_DIR/area/area_detail.rpt
report_area -include_physical -detail > $REPORT_SUMMARY_DIR/area/area_with_physical.rpt

# 各模块层次化面积
# report_area -hierarchy > $REPORT_SUMMARY_DIR/area/area_hierarchy.rpt

puts "✅ 面积报告已生成"

#=============================================================================
# 4. 汇总摘要
#=============================================================================
cus_report_separator "设计摘要"

# 门数统计
reportGateCount -level 0 -outfile $REPORT_SUMMARY_DIR/gate_count.rpt

# 设计规则违例
reportDesignRules -max_rule 10 > $REPORT_SUMMARY_DIR/design_rules.rpt

# 时钟树摘要
# report_clock_timing -type summary > $REPORT_SUMMARY_DIR/clock_summary.rpt

puts "✅ 9_report.tcl — 报告生成完成"
