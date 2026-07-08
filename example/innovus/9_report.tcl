#------------------------------------
# power
#------------------------------------
if {[file exist ${REPORT_DIR}/summary_3dims/power]} {
    rm -rf $REPORT_DIR/summary_3dims/power/*
} else {
    mkdir -p $REPORT_DIR/summary_3dims/power
}



set_power_analysis_mode -reset
set_power_analysis_mode -method static \
    -analysis_view setup_view \
    -corner max -create_binary_db true \
    -write_static_currents true \
    -honor_negative_energy true \
    -ignore_control_signals true

set_power_output_dir -reset
set_power_output_dir $REPORT_DIR/summary_3dims/power

set_default_switching_activity -reset
set_default_switching_activity -input_activity 0.2 -period 10.0

read_activity_file -reset
set_power -reset
set_powerup_analysis -reset
set_dynamic_power_simulation -reset

report_power -rail_analysis_format VS -net -format detailed -outfile $REPORT_DIR/summary_3dims/power/usb_link_top.rpt -output $REPORT_DIR/summary_3dims/power
# report_power -hierarchical -analysis
#------------------------------------
# delay
#------------------------------------
# file: generate timing reports.tcl
if {[file exist ${REPORT_DIR}/summary_3dims/timing]} {
    rm -rf $REPORT_DIR/summary_3dims/timing/*
} else {
    mkdir -p $REPORT_DIR/summary_3dims/timing
}
report_constraint -all_violators > $REPORT_DIR/summary_3dims/timing/violations.txt
report_ccopt_clock_trees -file $REPORT_DIR/summary_3dims/timing/clock_trees.rpt
report_ccopt_skew_groups -file $REPORT_DIR/summary_3dims/timing/skew_groups.rpt
report_timing -unconstrained -delay_limit 20 > $REPORT_DIR/summary_3dims/timing/timing_report_postCCopt.rpt
#------------------------------------
# area
#------------------------------------
if {[file exist ${REPORT_DIR}/summary_3dims/area]} {
    rm -rf $REPORT_DIR/summary_3dims/area/*
} else {
    mkdir -p $REPORT_DIR/summary_3dims/area
}

report_area -detail > $REPORT_DIR/summary_3dims/area/area_detail.txt
report_area -include_physical -detail > $REPORT_DIR/summary_3dims/area/area_with_physicalCells.txt
