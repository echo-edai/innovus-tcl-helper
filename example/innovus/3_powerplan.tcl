if {![file exist ${REPORT_DIR}/powerplan]} {
    exec mkdir -p ${REPORT_DIR}/powerplan
    echo "Creating ${REPORT_DIR}/powerplan !!!"
}

if {$UPF_FLOW} {
# Add Power Switch for VSW_5r and VSW_5t
addPowerSwitch -column \
    -powerDomain SW5r_v09 \
    -enableNetOut u_pmu/crc5_r_u0 \
    -switchModuleInstance crc5_r_u0 \
    -1801PowerSwitchRuleName ps5r \
    -leftOffset [expr $core_site_width*5] -bottomOffset [expr $core_site_height*1] \
    -horizontalPitch 12 \
    -checkerBoard \
    -loopBackAtEnd \
    -globalSwitchCellName HSWX1

addPowerSwitch -column \
    -powerDomain SW5t_v09 \
    -enableNetOut u_pmu/crc5_t_pd \
    -switchModuleInstance crc5_t_u0 \
    -1801PowerSwitchRuleName ps5t \
    -leftOffset [expr $core_site_width*5] -bottomOffset [expr $core_site_height*1] \
    -horizontalPitch 12 \
    -checkerBoard \
    -loopBackAtEnd \
    -globalSwitchCellName HSWX1
}
# Global Net Connects ($VDD_PIN, $VSS_PIN)
globalNetConnect $VDD_PIN -type pgpin -pin $VDD_PIN -instanceBasename * -override
globalNetConnect $VSS_PIN -type pgpin -pin $VSS_PIN -instanceBasename * -override
globalNetConnect $VDD_PIN -type tiehi -pin $VDD_PIN -instanceBasename * -override
globalNetConnect $VSS_PIN -type tielo -pin $VSS_PIN -instanceBasename * -override

#------------------------------------
# Create Power Rings
#------------------------------------
# Set Add Ring Mode for stacked vias
setAddRingMode -reset
setAddRingMode -stacked_via_bottom_layer $BOTTOM_LAYER -stacked_via_top_layer $TOP_LAYER

# Add Core Rings (around core area)
addRing -center 1 \
    -nets [list $VDD_PIN $VSS_PIN] \
    -type core_rings \
    -layer [list top $TOP_LAYER bottom $BOTTOM_LAYER left $LEFT_LAYER right $RIGHT_LAYER] \
    -width [expr $core_site_width*10] \
    -spacing [expr $core_site_width*5] \
    -offset [expr $core_site_width*20] \
    -jog_distance [expr $core_site_width*20] \
    -threshold [expr $core_site_width*20]

#------------------------------------
# Create Power Stripes
#------------------------------------
setAddStripeMode -reset
setAddStripeMode -stacked_via_bottom_layer $BOTTOM_LAYER -stacked_via_top_layer $TOP_LAYER
setAddStripeMode -ignore_nondefault_domains 1

# Add horizontal stripes on $TOP_LAYER
addStripe -nets [list $VDD_PIN $VSS_PIN] \
    -layer M7 \
    -direction horizontal \
    -width [expr $core_site_height*0.8] \
    -spacing [expr $core_site_height*0.6] \
    -set_to_set_distance [expr $core_site_height*9*2] \
    -start_from bottom \
    -start_offset [expr $core_site_height*4.5] \
    -stop_offset 0 \
    -block_ring_top_layer_limit $TOP_LAYER \
    -block_ring_bottom_layer_limit $BOTTOM_LAYER

# Add vertical stripes on M6
addStripe -nets [list $VDD_PIN $VSS_PIN] \
    -layer M6 \
    -direction vertical \
    -width [expr $core_site_width*9*0.8] \
    -spacing [expr $core_site_width*6] \
    -set_to_set_distance [expr $core_site_width*18*4] \
    -start_from left \
    -start_offset [expr $core_site_width*2] \
    -stop_offset 0 \
    -block_ring_top_layer_limit $TOP_LAYER \
    -block_ring_bottom_layer_limit $BOTTOM_LAYER \
    -stacked_via_bottom_layer $BOTTOM_LAYER \
    -stacked_via_top_layer $TOP_LAYER \
    -break_at_selected_blocks 1 \
    -merge_stripes_value [expr $core_site_width*2] \
    -max_same_layer_jog_length [expr $core_site_width*2]

setAddStripeMode -ignore_nondefault_domains 0
#------------------------------------
# sroute
#------------------------------------
sroute -connect { blockPin corePin } \
    -nets [list $VDD_PIN $VSS_PIN] \
    -layerChangeRange [list ${BOTTOM_LAYER}(${BOTTOM_LAYER_NUM}) ${TOP_LAYER}(${TOP_LAYER_NUM}) ] \
    -crossoverViaLayerRange [list $BOTTOM_LAYER $TOP_LAYER] \
    -targetViaLayerRange [list $BOTTOM_LAYER $TOP_LAYER] \
    -blockPinTarget { nearestRingStripe nearestTarget } \
    -checkAlignedSecondaryPin 1 \
    -blockPin useLef \
    -allowJogging 1 \
    -allowLayerChange 1

sroute -connect {padPin padRing floatingStripe} \
    -nets [list $VDD_PIN $VSS_PIN ] \
    -crossoverViaLayerRange [list $BOTTOM_LAYER $TOP_LAYER] \
    -targetViaLayerRange [list $BOTTOM_LAYER $TOP_LAYER] \
    -allowJogging true \
    -allowLayerChange true \
    -layerChangeRange [list ${BOTTOM_LAYER}(${BOTTOM_LAYER_NUM})${TOP_LAYER}(${TOP_LAYER_NUM}) ]


if {$UPF_FLOW} {
#------------------------------------
# for power domains
#------------------------------------
# Add Block Rings (around block domains)
#------------------------------------
deselectAll
selectObject Group SW5t_v09

addRing -nets [list VSW_5t $VSS_PIN ] \
    -around power_domain \
    -jog_distance [expr $core_site_width*20] \
    -threshold [expr $core_site_width*20] \
    -type block_rings \
    -layer {top M7 bottom M7 left M6 right M6} \
    -width [expr $core_site_width*5] \
    -spacing [expr $core_site_width*5] \
    -offset [expr $core_site_width*10]

deselectAll
selectObject Group SW5r_v09

addRing -nets [list VSW_5r $VSS_PIN ] \
    -around power_domain \
    -jog_distance [expr $core_site_width*20] \
    -threshold [expr $core_site_width*20] \
    -type block_rings \
    -layer {top M7 bottom M7 left M6 right M6} \
    -width [expr $core_site_width*5] \
    -spacing [expr $core_site_width*5] \
    -offset [expr $core_site_width*10]
#------------------------------------
# add stripes for power domains
#------------------------------------
setAddStripeMode -reset
setAddStripeMode -stacked_via_bottom_layer $BOTTOM_LAYER -stacked_via_top_layer $TOP_LAYER
setAddStripeMode -ignore_nondefault_domains 1

# Add vertical stripes on M8 for VSW_5t
deselectAll
selectObject Group SW5t_v09
addStripe -nets [list VSW_5t $VSS_PIN ] \
    -layer M8 \
    -direction vertical \
    -width [expr $core_site_width*6] \
    -spacing [expr $core_site_width*3] \
    -set_to_set_distance [expr $core_site_width*18*3] \
    -start_from_left \
    -start_offset [expr $core_site_width*19] \
    -stop_offset 0 \
    -block_ring_top_layer_limit $TOP_LAYER \
    -block_ring_bottom_layer_limit $BOTTOM_LAYER \
    -over_power_domain 1 \
    -padcore_ring_bottom_layer_limit $BOTTOM_LAYER \
    -break_at_selected_blocks 1 \
    -padcore_ring_top_layer_limit M3 \
    -merge_stripes_value [expr $core_site_width*2] \
    -max_same_layer_jog_length [expr $core_site_width*2]
# -xleft_offset 138 \
# -merge_stripes_value [expr $core_site_width*2]

# Add vertical stripes on M8 for VSW_5r
deselectAll
selectObject Group SW5r_v09
addStripe -nets [list VSW_5r $VSS_PIN ] \
    -layer M8 \
    -direction vertical \
    -width [expr $core_site_width*6] \
    -spacing [expr $core_site_width*3] \
    -set_to_set_distance [expr $core_site_width*18*3] \
    -start_from_left \
    -start_offset [expr $core_site_width*19] \
    -stop_offset 0 \
    -block_ring_top_layer_limit $TOP_LAYER \
    -block_ring_bottom_layer_limit $BOTTOM_LAYER \
    -over_power_domain 1 \
    -padcore_ring_bottom_layer_limit $BOTTOM_LAYER \
    -break_at_selected_blocks 1 \
    -padcore_ring_top_layer_limit M3 \
    -merge_stripes_value [expr $core_site_width*2] \
    -max_same_layer_jog_length [expr $core_site_width*2]
#------------------------------------
# Sroute for power domains
#------------------------------------
# Route connections for power networks
setSrouteMode -viaConnectToShape {ring blockring blockpin}
sroute -connect {blockPin corePin} \
    -nets [list VSW_5r $VSS_PIN ] \
    -powerDomains { SW5r_v09 } \
    -layerChangeRange [list $BOTTOM_LAYER(${BOTTOM_LAYER_NUM}) $TOP_LAYER(${TOP_LAYER_NUM}) ] \
    -crossoverViaLayerRange [list $BOTTOM_LAYER $TOP_LAYER] \
    -targetViaLayerRange [list $BOTTOM_LAYER $TOP_LAYER] \
    -blockPinTarget { nearestRingStripe nearestTarget } \
    -padPinPortConnect { allPort oneGeom } \
    -checkAlignedSecondaryPin 1 \
    -blockPin useLef \
    -allowJogging true \
    -allowLayerChange true

sroute -connect { blockPin corePin } \
    -nets [list VSW_5t $VSS_PIN ] \
    -powerDomains { SW5t_v09 } \
    -layerChangeRange [list $BOTTOM_LAYER(${BOTTOM_LAYER_NUM}) $TOP_LAYER(${TOP_LAYER_NUM}) ] \
    -crossoverViaLayerRange [list $BOTTOM_LAYER $TOP_LAYER] \
    -targetViaLayerRange [list $BOTTOM_LAYER $TOP_LAYER] \
    -blockPinTarget { nearestRingStripe nearestTarget } \
    -checkAlignedSecondaryPin 1 \
    -blockPin useLef \
    -allowJogging true \
    -allowLayerChange true
}

# Verification steps
verify_drc -limit 9999 -report $REPORT_DIR/powerplan/verify.drc.rpt
verifyConnectivity -net [list $VDD_PIN $VSS_PIN ] -error 1000 -warning 50 -type special -report $REPORT_DIR/powerplan/verifyConnectivity.rpt
