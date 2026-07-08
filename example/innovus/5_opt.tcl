# checkdesign -all
# sdc
# timedesign -preplace
# reportdontusecells
# analysis view
# optimize mode
# log
# place_opt_design -incremental_timing
# else与前面的}一定要隔离,如果紧紧挨着会出问题
if {![file exist ${REPORT_DIR}/opt]} {
    exec mkdir -p ${REPORT_DIR}/opt
    echo "Creating ${REPORT_DIR}/opt !!!"
}

### optimize the design
setDelayCalMode -siAware false
setAnalysisMode -analysisType onChipVariation
setOptMode -fixFanoutLoad true

# optDesign -preCTS/-postCTS/-postRoute
setTieHiLoMode  -maxFanOut 10 -cell [list $TIELO_CELL $TIEHI_CELL]

# addTieHilo -cell [list $TIELO_CELL $TIEHI_CELL] -prefix TIE

if {$UPF_FLOW} {
    addTieHiLo -powerDomain AO_v09      -cell [list $TIELO_CELL $TIEHI_CELL] -prefix TIE
    addTieHiLo -powerDomain SW5r_v09    -cell [list $TIELO_CELL $TIEHI_CELL] -prefix TIE
    addTieHiLo -powerDomain SW5t_v09    -cell [list $TIELO_CELL $TIEHI_CELL] -prefix TIE

    reportIsolation -from SW5r_v09 -to AO_v09 -highlight
    reportIsolation -from SW5t_v09 -to AO_v09 -highlight

    setOptMode -resizeShifterAndIsoInsts true
} else {
    addTieHiLo -cell [list $TIELO_CELL $TIEHI_CELL] -prefix TIE
}

if {$DEBUG} {
    reportAlwaysOnBuffer -all -verbose
}


set_interactive_constraint_modes [all_constraint_modes -active]
setLimitedAccessFeature ediUsePreRouteGigaOpt 1
optDesign -preCTS -outDir $REPORT_DIR/opt -prefix prects

### output the timing
checkPlace
check_timing -verbose > $REPORT_DIR/opt/check_timing.rpt
report_timing -unconstrained -delay_limit 20 > $REPORT_DIR/opt/timing_report_postPlace.rpt
timeDesign -preCTS -outDir $REPORT_DIR/opt/preCTS_time
verifyPowerDomain -bind -gconn -isoNetPD $REPORT_DIR/opt/place.isonets.rpt -xNetPD $REPORT_DIR/opt/place.xnets.rpt
