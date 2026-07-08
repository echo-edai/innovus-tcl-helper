# Save I/O file if not already saved
if {![file exist ${REPORT_DIR}/verify]} {
    exec mkdir -p ${REPORT_DIR}/verify
    echo "Creating ${REPORT_DIR}/verify !!!"
}

if { $read_io_file == 0 } {
    saveIoFile -locations -temp $IO_FILE
    cus_routeUnconnected
}

# Power and GND connection verification
verify_connectivity -type all > $REPORT_DIR/verify/verify_connectivity.rpt

# DRC (Design Rule Check)
verify_drc > $REPORT_DIR/verify/verify_drc

# LVS (Layout vs Schematic) check
verifyConnectivity > $REPORT_DIR/verify/verifyConnectivity

# Antenna rule check
verifyWellAntenna > $REPORT_DIR/verify/verifyWellAntenna

# AC Limit verification
verifyACLimit -use_db_freq -report $REPORT_DIR/verify/reportem1.rpt

# Reset default switching activity
set_default_switching_activity -reset
set_default_switching_activity -input_activity 0.2 -seq_activity 0.2

propagate_activity
# Write TCF file for further use
write_tcf $REPORT_DIR/verify/test.tcf
# Fix AC Limit violations based on report

saveDesign $DB_DIR/finish.enc

# fixACLimitViolation -useReportFile $REPORT_DIR/verify/reportem1.rpt
