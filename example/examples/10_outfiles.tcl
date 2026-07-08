#=============================================================================
# 阶段 10：输出文件生成
# 说明：导出 DEF、SPEF、SDF、网表和 GDSII 文件。
#=============================================================================

cus_report_separator "阶段 10: 输出文件生成"

set dbgLefDefOutVersion 5.8

#--------------
# 创建输出子目录
#--------------
cus_ensure_dir "${OUTPUT_DIR}/DEF"
cus_ensure_dir "${OUTPUT_DIR}/SPEF"
cus_ensure_dir "${OUTPUT_DIR}/SDF"
cus_ensure_dir "${OUTPUT_DIR}/NETLIST"
cus_ensure_dir "${OUTPUT_DIR}/GDSII"

#=============================================================================
# 1. DEF 文件（设计交换格式）
#=============================================================================
cus_report_separator "导出 DEF"

global dbgLefDefOutVersion
defOut -floorplan -netlist -routing ${OUTPUT_DIR}/DEF/top.def.gz

puts "✅ DEF 文件已导出"

#=============================================================================
# 2. SPEF 文件（标准寄生交换格式）
#=============================================================================
cus_report_separator "导出 SPEF"

# 最差拐角 SPEF
reset_parasitics
extractRC
rcOut -spef ${OUTPUT_DIR}/SPEF/worst.spef

# 最佳拐角 SPEF
reset_parasitics
extractRC
rcOut -spef ${OUTPUT_DIR}/SPEF/best.spef

# 如果有多个 RC 拐角，可以指定 -rc_corner 参数
# rcOut -spef ${OUTPUT_DIR}/SPEF/worst.spef -rc_corner rcworst_rc
# rcOut -spef ${OUTPUT_DIR}/SPEF/best.spef  -rc_corner rcbest_rc

puts "✅ SPEF 文件已导出"

#=============================================================================
# 3. SDF 文件（标准延迟格式）
#=============================================================================
cus_report_separator "导出 SDF"

all_hold_analysis_views
all_setup_analysis_views

write_sdf -view setup_view -ideal_clock_network ${OUTPUT_DIR}/SDF/setup_view.sdf
write_sdf -view hold_view  -ideal_clock_network ${OUTPUT_DIR}/SDF/hold_view.sdf

puts "✅ SDF 文件已导出"

#=============================================================================
# 4. 网表文件
#=============================================================================
cus_report_separator "导出网表"

# 标准 Verilog 网表（不含物理单元）
saveNetlist -excludeLeafCell ${OUTPUT_DIR}/NETLIST/layout_netlist.v

# LVS 网表（含电源地、排除物理填充单元）
set physical_cells [dbGet [dbGet top.insts.isPhysOnly 1 -p1].name]
lappend physical_cells [dbGet top.insts.cell.name -u -regexp .*FILL.*]

saveNetlist -excludeLeafCell \
    -excludeCellInst $physical_cells \
    -includePowerGround \
    -includePhysicalInst \
    -flattenBus ${OUTPUT_DIR}/NETLIST/layout_netlist.lvs.v

puts "✅ 网表文件已导出"

#=============================================================================
# 5. GDSII 文件（版图数据）
#=============================================================================
cus_report_separator "导出 GDSII"

setStreamOutMode -virtualConnection true

# 清理阻塞（GDS 导出前）
deleteRouteBlk -all
deletePlaceBlockage -all

streamOut ${OUTPUT_DIR}/GDSII/top.gds \
    -attachInstanceName 127 \
    -libName DesignLib \
    -units 1000 \
    -mode ALL

# 可选：合并参考库 GDS
# streamOut ${OUTPUT_DIR}/GDSII/top.gds \
#     -attachInstanceName 127 \
#     -libName DesignLib \
#     -units 1000 \
#     -mode ALL \
#     -merge {/path/to/stdcell.gds /path/to/macro.gds}

puts "✅ GDSII 文件已导出"

#=============================================================================
# 完成
#=============================================================================
cus_report_separator "全部输出文件生成完毕"
puts "输出目录: $OUTPUT_DIR"
puts "  DEF/     — 设计交换格式"
puts "  SPEF/    — 寄生参数"
puts "  SDF/     — 标准延迟格式"
puts "  NETLIST/ — Verilog 网表"
puts "  GDSII/   — 版图数据"

puts "✅ 10_outfiles.tcl — 输出文件生成完成"
