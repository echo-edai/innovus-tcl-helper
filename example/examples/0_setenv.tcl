#=============================================================================
# 阶段 0：全局环境变量与参数定义
# 说明：本文件集中定义所有工艺参数、路径和开关变量，供后续阶段引用。
#       所有 Innovus 命令从 1_init.tcl 开始使用。
#=============================================================================

#--------------
# 基础环境
#--------------
set UPF_FLOW     0                           ;# 低功耗流程开关（0=关闭, 1=开启）
set DEBUG        0                           ;# 调试模式开关
set SCRIPTS_DIR  [file dirname [info script]] ;# 脚本所在目录（自动获取）
set PERIOD       2.5                         ;# 时钟周期 (ns)

#--------------
# 工艺库配置（用户需要根据实际 PDK 修改）
#--------------
set VERSION       "smic13_tt"
set LIBRARY_NAME  "smic13_tt"
set LIBRARY_DIR   "/home/eda/PDK/digital/smic130/STD"
set LIB_FILE      "$LIBRARY_DIR/Synopsys/$LIBRARY_NAME.lib"
set CELL_LEF      "$LIBRARY_DIR/LEF/stdcell8_antenna.lef"
set TECH_LEF_PATH "$LIBRARY_DIR/LEF/stdcell8.lef"

#--------------
# MMMC 约束文件配置
#--------------
set GENERATE_MMMC           0               ;# 是否自动生成 MMMC 文件
set RC_WORST_CAP            ""
set RC_BEST_CAP             ""
set WORST_TEMP              "0"             ;# 最差温度 (℃)
set BEST_TEMP               "125"           ;# 最佳温度 (℃)
set SDC_FILES               "$SCRIPTS_DIR/../../DC/output/$VERSION/sdc/top.sdc"
set MMMC_TEMPLATE_FILE_PATH "$SCRIPTS_DIR/../input/template/template.mmmc"
set MMMC_FILE               "$SCRIPTS_DIR/../input/$VERSION/mmmc/corner.mmmc"

#--------------
# 设计输入
#--------------
set NETLIST_FILE  "$SCRIPTS_DIR/../../DC/output/$VERSION/syn_netlist/top_$VERSION.v"
set TOP_CELL      "top"
set TIMING_LIBS   [list "$LIB_FILE"]
set read_io_file  0                           ;# 是否读取已有 IO 文件
set IO_FILE       "$SCRIPTS_DIR/../input/$VERSION/io/top.io"

#--------------
# 电源网络
#--------------
set VDD_PIN "VDD"
set VSS_PIN "GND"

#--------------
# 输出目录
#--------------
set REPORT_DIR  $SCRIPTS_DIR/../output/$VERSION/reports
set OUTPUT_DIR  $SCRIPTS_DIR/../output/$VERSION/output
set DB_DIR      $SCRIPTS_DIR/../output/$VERSION/dbs

#--------------
# CPF 低功耗文件
#--------------
set CPF_FILE "$SCRIPTS_DIR/../input/$VERSION/cpf/power_intent_$VERSION.cpf"

#--------------
# FloorPlan 尺寸参数
#--------------
set CORE_SITE         CoreSite                ;# 核心区域 site 类型
set core_site_width   0.410                   ;# site 宽度 (um)
set core_site_height  3.690                   ;# site 高度 (um)
set core_width        400                     ;# 核心区域宽度 (site 单位)
set core_height       40                      ;# 核心区域高度 (site 单位)

set MACRO_SITE        CoreSite                ;# 宏单元区域 site 类型
set macro_site_width  0.8
set macro_site_height 1.8
set macro_width       0
set macro_height      0

set EXTEND_SITE       bcoreExt                ;# 扩展区域 site 类型（UPF 使用）

# IO 与核心区域间距
set io_core_spacing_width   30
set io_core_spacing_height  3
set io_die_spacing_width    30
set io_die_spacing_height   3

#--------------
# Placement 配置
#--------------
set ENDCAP_CELL   "FILLER16HD"               ;# 端帽单元
set WELLTAP_CELL  "FILLER16HD"               ;# 阱接触单元

#--------------
# Power Plan 金属层配置
#--------------
set TOP_LAYER        "M8"
set BOTTOM_LAYER     "M1"
set TOP_LAYER_NUM    8
set BOTTOM_LAYER_NUM 1
set LEFT_LAYER       "M7"
set RIGHT_LAYER      "M8"

#--------------
# Tie-Hi / Tie-Lo 单元
#--------------
set TIEHI_CELL "TIEHHD"
set TIELO_CELL "TIELHD"

#--------------
# CTS 时钟树配置
#--------------
set NDR_LEAF_RULE       CTS_2W1S             ;# 叶节点 NDR 规则名
set LEAF_RULE_WIDTH     2                    ;# 叶节点线宽倍率
set LEAF_RULE_SPACING   1                    ;# 叶节点间距倍率

set NDR_TRUNK_RULE      CTS_2W2S             ;# 主干 NDR 规则名
set TRUNK_RULE_WIDTH    2                    ;# 主干线宽倍率
set TRUNK_RULE_SPACING  2                    ;# 主干间距倍率

set CTS_CLK "clk"                            ;# 时钟信号名

#--------------
# 自动生成输出目录
#--------------
foreach dir [list $REPORT_DIR $OUTPUT_DIR $DB_DIR] {
    if {![file exist $dir]} {
        exec mkdir -p $dir
        puts "Created directory: $dir"
    }
}

puts "✅ 0_setenv.tcl — 环境变量加载完成"
