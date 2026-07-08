#=============================================================================
# 阶段 6：时钟树综合 (Clock Tree Synthesis)
# 说明：创建时钟树，定义 NDR 规则，设置 skew/target 约束。
#=============================================================================

cus_report_separator "阶段 6: 时钟树综合 (CTS)"

cus_ensure_dir "${REPORT_DIR}/CTS"

#--------------
# 启用 Native CTS 模式
#--------------
setLimitedAccessFeature ccopt_native_cts 1
set_ccopt_mode -integration native

#--------------
# NanoRoute 模式基础设置
#--------------
setNanoRouteMode -quiet -routeTopRoutingLayer $TOP_LAYER_NUM

#--------------
# 定义 NDR (Non-Default Rule) — 时钟线宽/间距规则
#--------------
# 叶节点规则（2倍线宽，1倍间距）
add_ndr -name $NDR_LEAF_RULE \
    -spacing_multiplier [list ${BOTTOM_LAYER}:${TOP_LAYER} $LEAF_RULE_SPACING] \
    -width_multiplier   [list ${BOTTOM_LAYER}:${TOP_LAYER} $LEAF_RULE_WIDTH]

# 主干规则（2倍线宽，2倍间距）
add_ndr -name $NDR_TRUNK_RULE \
    -spacing_multiplier [list ${BOTTOM_LAYER}:${TOP_LAYER} $TRUNK_RULE_SPACING] \
    -width_multiplier   [list ${BOTTOM_LAYER}:${TOP_LAYER} $TRUNK_RULE_WIDTH]

#--------------
# 定义布线类型（Route Type）
#--------------
create_route_type -name leaf_rule \
    -non_default_rule $NDR_LEAF_RULE \
    -bottom_preferred_layer M6 \
    -top_preferred_layer    M7

create_route_type -name trunk_rule \
    -non_default_rule $NDR_TRUNK_RULE \
    -bottom_preferred_layer M7 \
    -top_preferred_layer    $TOP_LAYER

#--------------
# 绑定布线类型到时钟网络层级
#--------------
set_ccopt_property -net_type leaf  -route_type leaf_rule
set_ccopt_property -net_type trunk -route_type trunk_rule

#--------------
# 时钟树约束
#--------------
# 最大转换时间 = 时钟周期的 10%
set_ccopt_property -net_type trunk target_max_trans [expr 0.1 * $PERIOD]
set_ccopt_property -net_type leaf  target_max_trans [expr 0.1 * $PERIOD]

# 可选：设置目标 skew
# set_ccopt_property target_skew [expr 0.05 * $PERIOD]

#--------------
# 时钟树信息报告（CTS 前）
#--------------
report_clocks
get_clocks

#--------------
# 创建 Skew Group
#--------------
create_ccopt_skew_group -name ref_clk_grp \
    -source $CTS_CLK \
    -auto_sinks

# 可选：设置 skew group 目标 skew
# set_ccopt_property -skew_group ref_clk_grp target_skew [expr 0.1 * $PERIOD]

#--------------
# 生成 CTS Spec 文件
#--------------
cus_ensure_dir "${REPORT_DIR}/CTS_specs"
create_ccopt_clock_tree_spec -file $REPORT_DIR/CTS_specs/cts.spec -immediate

#--------------
# 执行时钟树综合
#--------------
setDelayCalMode -engine aae
set_ccopt_effort -high

clock_opt_design -cts

#--------------
# CTS 后时序报告
#--------------
report_ccopt_clock_trees -file $REPORT_DIR/CTS/clock_trees.rpt
report_ccopt_skew_groups -file $REPORT_DIR/CTS/skew_groups.rpt
report_timing -max_paths 100 > $REPORT_DIR/CTS/timing_postCTS.rpt

cus_save "6_CTS"
puts "✅ 6_CTS.tcl — 时钟树综合完成"
