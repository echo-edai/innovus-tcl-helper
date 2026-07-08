set dbgLefDefOutVersion 5.8
#---------------------------
# Output DEF File
#---------------------------
global dbgLefDefOutVersion
defOut -floorplan -netlist -routing $OUTPUT_DIR/DEF/top.def.gz
#---------------------------
# Output spef File
#---------------------------
reset_parasitics
extractRC
# rcOut -spef $OUTPUT_DIR/SPEF/worst.spef -rc_corner rcworst_rc
rcOut -spef $OUTPUT_DIR/SPEF/worst.spef

reset_parasitics
extractRC
# rcOut -spef $OUTPUT_DIR/SPEF/best.spef -rc_corner rcbest_rc
rcOut -spef $OUTPUT_DIR/SPEF/best.spef
#---------------------------
# Output sdf File
#---------------------------
all_hold_analysis_views
all_setup_analysis_views
if {![file exist ${OUTPUT_DIR}/SDF]} {
    exec mkdir -p ${OUTPUT_DIR}/SDF
    echo "Creating ${OUTPUT_DIR}/SDF !!!"
}
write_sdf -view setup_view  -ideal_clock_network $OUTPUT_DIR/SDF/setup_view.sdf
write_sdf -view hold_view   -ideal_clock_network $OUTPUT_DIR/SDF/hold_view.sdf
#---------------------------
# Output netlist File
#---------------------------
# saveNetlist $OUTPUT_DIR/NETLIST/layout_netlist.v
set physical_cells [dbGet [dbGet top.insts.isPhysOnly 1 -p1].name]
lappend physical_cells [dbGet top.insts.cell.name -u -regexp .*FILL.*]

saveNetlist -excludeLeafCell ./$OUTPUT_DIR/NETLIST/layout_netlist.v
saveNetlist -excludeLeafCell \
    -excludeCellInst $physical_cells \
    -includePowerGround \
    -includePhysicalInst \
    -flattenBus ./$OUTPUT_DIR/NETLIST/layout_netlist.lvs.v

# -phys -excludeLeafCell

#---------------------------
# Output gds File
#---------------------------
setStreamOutMode -virtualConnection true
deleteRouteBlk -all
deletePlaceBlockage -all

streamOut $OUTPUT_DIR/GDSII/top.gds \
    -attachInstanceName 127 \
    -libName DesignLib \
    -units 1000 -mode ALL \


    # -uniquifyCellNames \
    # -merge {/home/library/tsmc65lp/std/TSMCHOME/digital/Back_End/gds/tcbn65lp_200a/tcbn65lp.gds} \
    # -mapFile ../gds2map/gds2.map

saveDesign $DB_DIR/finish.enc
