# 设置初始化参数
set init_design_uniquify 1
setMultiCpuUsage -localCpu 10
set init_verilog $NETLIST_FILE

set init_design_netlisttype {Verilog}
set init_design_settop {1}
set init_top_cell ${TOP_CELL}

set init_lef_file "$TECH_LEF_PATH $CELL_LEF"

# 设置布局约束
set fp_core_cntl {aspect}
set fp_aspect_ratio {1.0000}
set extract_shrink_factor {1.0}
set init_assign_buffer {0}
set init_pwr_net "$VDD_PIN"
set init_gnd_net "$VSS_PIN"

# 是否移除已有分配
set init_remove_assigns 1
# init_no_new_assigns 25 version
# I/O 文件设置（注释掉）
# set init_io_file {scripts/top.save.io}

# 定义时序库文件
if {$UPF_FLOW} {
    set init_cpf_file ${CPF_FILE}
}

set init_mmmc_file ${MMMC_FILE}

# 启用矩形设计支持
setPreference EnableRectilinearDesign 1
# 初始化设计
init_design

# 设置全局报告格式（用于时序分析）
set_global report_timing_format {instance arc transition capacitance cell fanout load slew delay incr_delay arrival}

# 设置表格样式（报告格式）
set_table_style -no_frame_fix_width -nosplit
set_table_style -name report_timing

if {$UPF_FLOW} {
    # 读取电源意图（UPF 文件）
    read_power_intent -1801 ../../DC/upf/dc.upf
    commit_power_intent
    # 验证电源域
    verifyPowerDomain -isoNetPD
    verifyPowerDomain -xNetPD
}
