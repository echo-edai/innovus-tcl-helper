# 最好innovus支持输入tcl的环境变量。如果不支持，使用bash脚本生成tcl文件来修改变量
set UPF_FLOW 0
set DEBUG 0
set SCRIPTS_DIR [file dirname [info script]]
set PERIOD 2.5
# freeDesign

# set VERSION "saed32hvt_ff1p16vn40c"
# set LIBRARY_NAME "saed32hvt_ff1p16vn40c"
# set LIBRARY_DIR "/home/eda/PDK/digital/SAED_32-28nm/SAED32_EDK/lib/stdcell_hvt"
# set LIB_FILE "$LIBRARY_DIR/db_nldm/$LIBRARY_NAME.lib"
# set CELL_LEF "$LIBRARY_DIR/lef/saed32nm_hvt_1p9m.lef"
# set TECH_LEF_PATH "/home/eda/PDK/digital/SAED_32-28nm/SAED32_EDK/tech/tech_lef/saed32nm_1p9m_mw.lef"
# set TECH_LEF_PATH "/home/eda/ASIC_scripts/yanfuti_icc2_block/library/tech/tlef/saed32nm_1p9m.tech.lef"

set VERSION "smic13_tt"
set LIBRARY_NAME "smic13_tt"
set LIBRARY_DIR "/home/eda/PDK/digital/smic130/STD"
set LIB_FILE "$LIBRARY_DIR/Synopsys/$LIBRARY_NAME.lib"
set CELL_LEF "$LIBRARY_DIR/LEF/stdcell8_antenna.lef"
set TECH_LEF_PATH "$LIBRARY_DIR/LEF/stdcell8.lef"

set GENERATE_MMMC 0

set VDD_PIN "VDD"
set VSS_PIN "GND"
#--------------
# INPUT
#--------------
set NETLIST_FILE "$SCRIPTS_DIR/../../DC/output/$VERSION/syn_netlist/top_$VERSION.v"
set TOP_CELL "top"
set TIMING_LIBS [list "$LIB_FILE"]
# 设置是否读取已有的 I/O 文件
set read_io_file 0
set IO_FILE "$SCRIPTS_DIR/../input/$VERSION/io/top.io"
# 输出MMMC文件
set RC_WORST_CAP    ""
set RC_BEST_CAP     ""
set WORST_TEMP      "0"
set BEST_TEMP       "125"
set SDC_FILES "$SCRIPTS_DIR/../../DC/output/$VERSION/sdc/top.sdc"
set MMMC_TEMPLATE_FILE_PATH "$SCRIPTS_DIR/../input/template/template.mmmc"
# set MMMC_OUTPUT_FILE_PATH "$SCRIPTS_DIR/../input/$VERSION/mmmc/corner.mmmc"
set MMMC_FILE "$SCRIPTS_DIR/../input/$VERSION/mmmc/corner.mmmc"

if {$GENERATE_MMMC} {
    generate_constraint_script \
        $LIBRARY_NAME \
        $TIMING_LIBS \
        $SDC_FILES \
        $RC_WORST_CAP \
        $WORST_TEMP \
        $RC_BEST_CAP \
        $BEST_TEMP \
        $MMMC_FILE \
        $MMMC_TEMPLATE_FILE_PATH

}


#--------------
# OUTPUT
#--------------
set REPORT_DIR  $SCRIPTS_DIR/../output/$VERSION/reports
set OUTPUT_DIR  $SCRIPTS_DIR/../output/$VERSION/output
set DB_DIR      $SCRIPTS_DIR/../output/$VERSION/dbs

if {![file exist ${DB_DIR}]} {
    exec mkdir -p ${DB_DIR}
    echo "Creating ${DB_DIR} !!!"
}

#--------------
# CPF flow
#--------------
set CPF_FILE "$SCRIPTS_DIR/../input/$VERSION/cpf/power_intent_$VERSION.cpf"

#--------------
# 设置FloorPlan基本尺寸参数
#--------------
# 创建核心区域（core）
set CORE_SITE CoreSite
set core_site_width 0.410
set core_site_height 3.690
set core_width 400
set core_height 40
# 创建宏单元区域（gacore）
set MACRO_SITE CoreSite
set macro_site_width 0.8
set macro_site_height 1.8

set macro_width 0
set macro_height 0

# 创建扩展核心区域（coreExt）Not Support now
# it's used in UPF flow. see floorplan.tcl
set EXTEND_SITE bcoreExt

# 设置IO和wafer,wafer和core的距离
set io_core_spacing_width 30
set io_core_spacing_height 3
set io_die_spacing_width 30
set io_die_spacing_height 3

#--------------
# 设置Placement
#--------------
set ENDCAP_CELL "FILLER16HD"
set WELLTAP_CELL "FILLER16HD"
#--------------
# 设置Power Plan
#--------------
set TOP_LAYER "M8"
set BOTTOM_LAYER "M1"
set TOP_LAYER_NUM 8
set BOTTOM_LAYER_NUM 1
set LEFT_LAYER "M7"
set RIGHT_LAYER "M8"
#--------------
# 设置tieh tiel
#--------------
set TIEHI_CELL "TIEHHD"
set TIELO_CELL "TIELHD"
#--------------
# 设置CTS
#--------------
#特殊绕线的层设置,2指正常绕线的倍数
set NDR_LEAF_RULE CTS_2W1S
set LEAF_RULE_WIDTH 2
set LEAF_RULE_SPACING 1

set NDR_TRUNK_RULE CTS_2W2S
set TRUNK_RULE_WIDTH 2
set TRUNK_RULE_SPACING 2

set CTS_CLK "clk"
