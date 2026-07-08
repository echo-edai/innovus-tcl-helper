#=============================================================================
# 阶段 2：布图规划 (Floorplan)
# 说明：定义芯片核心区域尺寸、放置宏单元、设置 Halos/Blockage。
#=============================================================================

cus_report_separator "阶段 2: 布图规划"

#--------------
# 清理已有布局
#--------------
unplaceAllBlocks

#--------------
# 计算 FloorPlan 边界坐标
#   die_x = core_site_width * (2*io_core + 2*io_die + core)
#   core_x = core_site_width * (io_core + io_die)
#--------------
set die_lx  0.0
set die_ly  0.0
set die_ux  [expr $core_site_width  * ($io_core_spacing_width*2  + $io_die_spacing_width*2  + $core_width)]
set die_uy  [expr $core_site_height * ($io_core_spacing_height*2 + $io_die_spacing_height*2 + $core_height)]

set core_lx [expr $core_site_width  * $io_die_spacing_width]
set core_ly [expr $core_site_height * $io_die_spacing_height]
set core_ux [expr $core_site_width  * ($io_core_spacing_width*2  + $io_die_spacing_width  + $core_width)]
set core_uy [expr $core_site_height * ($io_core_spacing_height*2 + $io_die_spacing_height + $core_height)]

#--------------
# 创建 FloorPlan
# floorPlan -site <site> -b <lx> <ly> <ux> <uy> \
#     <core_lx> <core_ly> <core_ux> <core_uy> \
#     <io_lx>  <io_ly>  <io_ux>  <io_uy>
#--------------
floorPlan -site $CORE_SITE -b \
    $die_lx  $die_ly  $die_ux  $die_uy \
    $core_lx $core_ly $core_ux $core_uy \
    $core_lx $core_ly $core_ux $core_uy

#--------------
# 记录核心区域坐标（供后续阶段使用）
#--------------
set x1  [expr $core_site_width  * ($io_core_spacing_width  + $io_die_spacing_width)]
set y1  [expr $core_site_height * ($io_core_spacing_height + $io_die_spacing_height)]
set x2  [expr $x1 + $core_width]
set y2  [expr $y1 + $core_height]
set core_box [list $x1 $y1 $x2 $y2]

puts "Core Box: $core_box"
puts "Die  Size: ${die_ux}x${die_uy} um"
puts "Core Size: [expr $core_width * $core_site_width]x[expr $core_height * $core_site_height] um"

#--------------
# 宏单元放置（示例：根据实际设计修改坐标）
# 格式：placeInstance <inst_name> <x> <y> <orientation>
#--------------
# placeInstance macro_1  100  200  R0
# placeInstance macro_2  600  200  R0

#--------------
# 添加 Halo（宏单元周围的布线/放置阻塞区域）
#--------------
# addHaloToBlock 5 5 5 5 -allBlocks

#--------------
# UPF 低功耗：电源域分割
#--------------
if {$UPF_FLOW} {
    # 为不同电源域设置物理区域
    # setObjFPlanBox Group <domain_name>  <lx> <ly> <ux> <uy>
    # modifyPowerDomainAttr <domain_name> -minGaps <l> <b> <r> <t>
}

cus_save "2_floorplan"
puts "✅ 2_floorplan.tcl — 布图规划完成"
