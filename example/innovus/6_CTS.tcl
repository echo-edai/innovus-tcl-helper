# delete_route_type -name leaf_rule
# delete_route_type -name trunk_rule
if {![file exist ${REPORT_DIR}/CTS]} {
    exec mkdir -p ${REPORT_DIR}/CTS
    echo "Creating ${REPORT_DIR}/CTS !!!"
}
setLimitedAccessFeature ccopt_native_cts 1
set_ccopt_mode  -integration native
setNanoRouteMode -quiet -routeTopRoutingLayer $TOP_LAYER_NUM

add_ndr -name $NDR_LEAF_RULE \
    -spacing_multiplier [list $BOTTOM_LAYER:$TOP_LAYER $LEAF_RULE_SPACING] \
    -width_multiplier [list $BOTTOM_LAYER:$TOP_LAYER $LEAF_RULE_WIDTH]


add_ndr -name $NDR_TRUNK_RULE \
    -spacing_multiplier [list $BOTTOM_LAYER:$TOP_LAYER $TRUNK_RULE_SPACING] \
    -width_multiplier [list $BOTTOM_LAYER:$TOP_LAYER $TRUNK_RULE_WIDTH]


create_route_type -name leaf_rule  -non_default_rule $NDR_LEAF_RULE -bottom_preferred_layer M6 -top_preferred_layer M7
create_route_type -name trunk_rule -non_default_rule $NDR_TRUNK_RULE -bottom_preferred_layer M7 -top_preferred_layer $TOP_LAYER

set_ccopt_property -net_type leaf   -route_type leaf_rule
set_ccopt_property -net_type trunk  -route_type trunk_rule
# dbget head.allCells.name *BUF* -u
#set_ccopt_property buffer_cells {}
#set_ccopt_property inverter_cells {}

# set_ccopt_property -net_type trunk target_max_trans 300ps
# set_ccopt_property -net_type leaf target_max_trans 300ps
set_ccopt_property -net_type trunk  target_max_trans [expr 0.1*$PERIOD]
set_ccopt_property -net_type leaf   target_max_trans [expr 0.1*$PERIOD]

#ref:reload sdc
#update_constraint_mode -name common -sdc_files $SDC_FILE
#all_constraint_modes -active

report_clocks
get_clocks

#delete_ccopt_skew_group -name ref_clk_grp
create_ccopt_skew_group -name ref_clk_grp -source $CTS_CLK -auto_sinks
# set_ccopt_property -skew_group ref_clk_grp -constraint_mode sdc -target_skew [expr 0.1*$PERIOD]
#set_ccopt_property -skew_group ref_clk_grp -constraint_mode sdc -target_skew 0.2ns

# drv fixing balance??
# property --> sdc --> lib

create_ccopt_clock_tree_spec -file $REPORT_DIR/CTS_specs/cts.spec -immediate
setDelayCalMode -engine aae

source $REPORT_DIR/CTS_specs/cts.spec
# ccopt_design -cts
# report_timing
set_ccopt_effort -high

clock_opt_design -cts
# ccopt_design -cts

setAnalysisMode -cppr none
setOptMode -fixFanoutLoad true
setOptMode -holdTargetSlack [expr 0.1*$PERIOD]
# setOptMode -holdTargetSlack 0.3

optDesign -postCTS -outDir $REPORT_DIR/CTS -prefix postCTS
optDesign -postCTS -hold -outDir $REPORT_DIR/CTS -prefix postCTS_hold

##### Reports on clock trees and skew groups can be obtained using these CCOpt reporting command
report_ccopt_clock_trees -file $REPORT_DIR/CTS/clock_trees.rpt
report_ccopt_skew_groups -file $REPORT_DIR/CTS/skew_groups.rpt
report_timing -unconstrained -delay_limit 20 > $REPORT_DIR/CTS/timing_report_postccopt.rpt

###Cmds:re-CTS commands(Debugging purpose)
# delete_ccopt_clock_tree_spec
# delete methods before we re ccopt_desing
# selectNet -clock
# editDelete
# setInstancePlacementStatus -status placed -name *

###Ref: the main step of ccopt_design
## optimize the design after CTS
#timeDesign -postCTS        #check setup states
#timeDesign -postCTS -hold  #check hold  states
