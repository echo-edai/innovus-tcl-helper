# 删除所有已放置的块（如果存在）
unplaceAllBlocks
# 创建 floorplan
floorPlan -site $CORE_SITE -b \
    0.0 0.0 \
    [expr $core_site_width*($io_core_spacing_width*2+$io_die_spacing_width*2+$core_width)] \
    [expr $core_site_height*($io_core_spacing_height*2+$io_die_spacing_height*2+$core_height)] \
    [expr $core_site_width*$io_die_spacing_width] \
    [expr $core_site_height*$io_die_spacing_height] \
    [expr $core_site_width*($io_core_spacing_width*2+$io_die_spacing_width+$core_width)] \
    [expr $core_site_height*($io_core_spacing_height*2+$io_die_spacing_height+$core_height)] \
    [expr $core_site_width*($io_core_spacing_width+$io_die_spacing_width)] \
    [expr $core_site_height*($io_core_spacing_height+$io_die_spacing_height)] \
    [expr $core_site_width*($io_core_spacing_width+$io_die_spacing_width+$core_width)] \
    [expr $core_site_height*($io_core_spacing_height+$io_die_spacing_height+$core_height)]

# 计算核心区域坐标
set x1 [expr $core_site_width  * ($io_core_spacing_width + $io_die_spacing_width)]
set y1 [expr $core_site_height * ($io_core_spacing_height+$io_die_spacing_height)]
set x2 [expr $x1 + $core_width ]
set y2 [expr $y1 + $core_height]

set core_box [list $x1 $y1 $x2 $y2]
puts "Core Box: $core_box"

# # 删除所有行（用于重新创建）
# deleteRow -all

# # 创建宏单元区域（gacore）
# createRow -site $MACRO_SITE -area \
#     [expr $core_site_width*($io_core_spacing_width+$io_die_spacing_width)] \
#     [expr $core_site_height*($io_core_spacing_height+$io_die_spacing_height)] \
#     [expr $core_site_width*($io_core_spacing_width+$io_die_spacing_width+$macro_width)] \
#     [expr $core_site_height*($io_core_spacing_height+$io_die_spacing_height+$macro_height)]


if {$UPF_FLOW} {
    # # 创建核心区域（core）
    # createRow -site $CORE_SITE
    # # 创建扩展核心区域（coreExt）
    # createRow -site $EXTEND_SITE

    # 设置对象 FPlanBox（用于电源域划分）
    setObjFPlanBox Group SW5r_v09 \
        [expr $core_site_width*($io_core_spacing_width+$io_die_spacing_width+30)] \
        [expr $core_site_height*($io_core_spacing_height+$io_die_spacing_height+4)] \
        [expr $core_site_width*($io_core_spacing_width+$io_die_spacing_width+130)] \
        [expr $core_site_height*($io_core_spacing_height+$io_die_spacing_height+27)]

    setObjFPlanBox Group SW5t_v09 \
        [expr $core_site_width*($io_core_spacing_width+$io_die_spacing_width-180)] \
        [expr $core_site_height*($io_core_spacing_height+$io_die_spacing_height-12)] \
        [expr $core_site_width*($io_core_spacing_width+$io_die_spacing_width-370)] \
        [expr $core_site_height*($io_core_spacing_height+$io_die_spacing_height-23)]

    # 修改电源域属性（最小间隙）
    modifyPowerDomainAttr SW5r_v09 -minGaps \
        [expr $core_site_height*1] \
        [expr $core_site_height*1] \
        [expr $core_site_width*12] \
        [expr $core_site_width*12]

    modifyPowerDomainAttr SW5r_v09 -rsExts \
        [expr $core_site_height*1] \
        [expr $core_site_height*1] \
        [expr $core_site_width*12] \
        [expr $core_site_width*12]

    modifyPowerDomainAttr SW5t_v09 -minGaps \
        [expr $core_site_height*1] \
        [expr $core_site_height*1] \
        [expr $core_site_width*12] \
        [expr $core_site_width*12]

    modifyPowerDomainAttr SW5t_v09 -rsExts \
        [expr $core_site_height*1] \
        [expr $core_site_height*1] \
        [expr $core_site_width*12] \
        [expr $core_site_width*12]

    # 添加电源网络（VDD, VSS）
    # addNet $VDD_PIN -physical -power
    # addNet $VSS_PIN -physical -ground

    # 创建 PG Pin（电源/地引脚）
    # createPGPin -dir input $VDD_PIN -net $VDD_PIN -geom M2 95 0 95.1 0.52
    # createPGPin -dir input $VSS_PIN -net $VSS_PIN -geom M2 10.2 0 10.3 0.52

    # createPGPin -onDie -net VDD -width 2 -length 3
    # createPGPin -onDie -net VSS -width 2 -length 3

    # select_row -all
    # dbget select.name
    # dbget select.site.name
}
