#=============================================================================
# 阶段 3：电源规划 (Power Plan)
# 说明：创建电源环(power ring)、电源条纹(power stripe)、全局网络连接、
#       标准单元电源轨(sroute)。
#=============================================================================

cus_report_separator "阶段 3: 电源规划"

cus_ensure_dir "${REPORT_DIR}/powerplan"

#--------------
# 全局网络连接（将 PG pin 连接到全局电源网络）
# 必须在任何物理 PG 布线之前执行
#--------------
globalNetConnect $VDD_PIN -type pgpin   -pin $VDD_PIN -instanceBasename * -override
globalNetConnect $VSS_PIN -type pgpin   -pin $VSS_PIN -instanceBasename * -override
globalNetConnect $VDD_PIN -type tiehi   -pin $VDD_PIN -instanceBasename * -override
globalNetConnect $VSS_PIN -type tielo   -pin $VSS_PIN -instanceBasename * -override

#--------------
# UPF: 电源开关单元（Power Switch）
#--------------
if {$UPF_FLOW} {
    # 注意：以下为示例，实际参数根据 UPF 定义修改
    # addPowerSwitch -column \
    #     -powerDomain <domain_name> \
    #     -enableNetOut <enable_net> \
    #     -switchModuleInstance <instance> \
    #     -1801PowerSwitchRuleName <rule_name> \
    #     -leftOffset [expr $core_site_width*5] \
    #     -bottomOffset [expr $core_site_height*1] \
    #     -horizontalPitch 12 \
    #     -checkerBoard \
    #     -loopBackAtEnd \
    #     -globalSwitchCellName HSWX1
}

#--------------
# 创建电源环 (Core Rings)
# addRing 围绕核心区域创建 VDD/VSS 环
#--------------
setAddRingMode -reset
setAddRingMode -stacked_via_bottom_layer $BOTTOM_LAYER \
               -stacked_via_top_layer    $TOP_LAYER

addRing -center 1 \
    -nets [list $VDD_PIN $VSS_PIN] \
    -type core_rings \
    -layer [list top    $TOP_LAYER    bottom $BOTTOM_LAYER \
                  left   $LEFT_LAYER   right  $RIGHT_LAYER] \
    -width   [expr $core_site_width  * 10] \
    -spacing [expr $core_site_width  * 5]  \
    -offset  [expr $core_site_width  * 20] \
    -jog_distance [expr $core_site_width  * 20] \
    -threshold    [expr $core_site_width  * 20]

#--------------
# 创建电源条纹 (Power Stripes)
# addStripe 在芯片内部插入垂直/水平电源条纹
#--------------
setAddStripeMode -reset
setAddStripeMode -stacked_via_bottom_layer $BOTTOM_LAYER \
                 -stacked_via_top_layer    $TOP_LAYER
setAddStripeMode -ignore_nondefault_domains 1

# 垂直方向 VDD/VSS 条纹（顶层金属）
addStripe -nets [list $VDD_PIN $VSS_PIN] \
    -layer $TOP_LAYER \
    -direction vertical \
    -width [expr $core_site_width * 5] \
    -spacing [expr $core_site_width * 2] \
    -set_to_set_distance [expr $core_site_width * 100] \
    -start_offset [expr $core_site_width * 50]

# 水平方向 VDD/VSS 条纹（次顶层金属）
addStripe -nets [list $VDD_PIN $VSS_PIN] \
    -layer $LEFT_LAYER \
    -direction horizontal \
    -width [expr $core_site_width * 5] \
    -spacing [expr $core_site_width * 2] \
    -set_to_set_distance [expr $core_site_width * 100] \
    -start_offset [expr $core_site_width * 50]

#--------------
# 标准单元电源轨 (Special Route)
# sroute 自动连接标准单元的 VDD/VSS 到电源网络
#--------------
sroute -connect { blockPin padRing corePin floatingStripe } \
    -layerChangeRange [list $BOTTOM_LAYER $TOP_LAYER] \
    -blockPinTargetLayers [list $BOTTOM_LAYER $TOP_LAYER] \
    -padPinPortConnectTcl 1 \
    -allowJogging 1 \
    -crossoverViaLayerRange [list $BOTTOM_LAYER $TOP_LAYER] \
    -nets [list $VDD_PIN $VSS_PIN]

cus_save "3_powerplan"
puts "✅ 3_powerplan.tcl — 电源规划完成"
