#=============================================================================
# 阶段 1：设计初始化 (init_design)
# 说明：设置 init_* 隐式变量，加载网表/LEF/MMMC，初始化设计。
#       注意：init_* 变量由 init_design 自动读取，无需 $ 显式引用。
#=============================================================================

cus_report_separator "阶段 1: 设计初始化"

#--------------
# 多核并行配置
#--------------
setMultiCpuUsage -localCpu 10

#--------------
# init_design 隐式变量（按命名约定自动读取）
#--------------
set init_design_uniquify  1                   ;# uniquify 所有实例
set init_verilog          $NETLIST_FILE       ;# 网表文件
set init_design_netlisttype {Verilog}         ;# 网表类型
set init_design_settop    {1}                 ;# 自动设置顶层
set init_top_cell         ${TOP_CELL}          ;# 顶层模块名
set init_lef_file         "$TECH_LEF_PATH $CELL_LEF"  ;# LEF 文件
set init_pwr_net          "$VDD_PIN"          ;# 电源网络名
set init_gnd_net          "$VSS_PIN"          ;# 地网络名
set init_remove_assigns   1                   ;# 移除 assign 语句
set init_assign_buffer    0                   ;# assign 缓冲区数量

#--------------
# FloorPlan 预设参数
#--------------
set fp_core_cntl       {aspect}              ;# 核心区域控制方式
set fp_aspect_ratio    {1.0000}              ;# 宽高比
set extract_shrink_factor {1.0}              ;# 提取缩放因子

#--------------
# MMMC / CPF 文件
#--------------
if {$UPF_FLOW} {
    set init_cpf_file ${CPF_FILE}
}
set init_mmmc_file ${MMMC_FILE}

#--------------
# 执行设计初始化
#--------------
cus_check_file $NETLIST_FILE      "网表文件"
cus_check_file $TECH_LEF_PATH     "技术 LEF"
cus_check_file $CELL_LEF          "标准单元 LEF"

setPreference EnableRectilinearDesign 1      ;# 支持矩形设计
init_design

#--------------
# 全局报告格式设置
#--------------
set_global report_timing_format {instance arc transition capacitance cell fanout load slew delay incr_delay arrival}
set_table_style -no_frame_fix_width -nosplit -name report_timing

#--------------
# UPF 低功耗流程
#--------------
if {$UPF_FLOW} {
    read_power_intent -1801 ../../DC/upf/dc.upf
    commit_power_intent
    verifyPowerDomain -isoNetPD
    verifyPowerDomain -xNetPD
}

cus_save "1_init"
puts "✅ 1_init.tcl — 设计初始化完成"
