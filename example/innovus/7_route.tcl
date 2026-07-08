# secondary power pin connection
# setPGPinUseSignalRoute crc5_r_u0/token0_reg_4 :ExtVDD_PINVX1:ExtVDD_LSLH_ISONL_X1_TO_ON:ExtVDD_SRDFF*:ExtVDD
if {![file exist ${REPORT_DIR}/route]} {
    exec mkdir -p ${REPORT_DIR}/route
    echo "Creating ${REPORT_DIR}/route !!!"
}

setPGPinUseSignalRoute -all
setNanoRouteMode -routeStripeLayerRange 4:8
setNanoRouteMode -drouteUseMultiCutViaEffort medium

if { $UPF_FLOW } {
    routePGPinUseSignalRoute -all -nets {VSM_5r,VSM_5t}
}

setNanoRouteMode -routeStripeLayerRange ""
#setNanoRouteMode -drouteEndIteration 5
# routePGPinUseSignalRoute

setRouteMode \
    -earlyGlobalMaxRouteLayer $TOP_LAYER_NUM \
    -earlyGlobalMinRouteLayer $BOTTOM_LAYER_NUM
earlyGlobalRoute
#LPE
reset_parasitics
extractRC
#SMART Routing : NanoRoute
#设置多孔的优化
setNanoRouteMode -routeWithTimingDriven true
setNanoRouteMode -drouteUseMultiCutViaEffort high
setNanoRouteMode -routeReserveSpaceForMultiCut true
setNanoRouteMode -droutePostRouteSwapViaPriority auto
#| allNets | criticalNetsFirst | noCriticalOnly(default)]
setNanoRouteMode -droutePostRouteSwapVia multiCut
#设置via的权重
setNanoRouteMode -dbAdjustAutoViaWeight true
setNanoRouteMode -dbViaWeight {vianame weight}
#开启SI分析
setDelayCalMode -siAware true -engine aae
#允许插入antenna cell
setNanoRouteMode -drouteFixAntenna true \
    -routeAntennaCellName ANTENNA -routeInsertAntennaDiode true
#spread wire
setNanoRouteMode -drouteMinSlackForWireOptimization 0.1
#setup slack大于0.1ns才会优化)
setNanoRouteMode -droutePostRouteSpreadWire true
#widen wire
setNanoRouteMode -droutePostRouteWidenWire true
#enable advanced search repair
setNanoRouteMode -drouteExpAdvancedSearchFix true
#route阶段开启optimization
setNanoRouteMode -routeWithOpt true
setNanoRouteMode -routeStrictlyHonorNonDefaultRule 3:6
routeDesign
###is equal to cmd:   routeDesign
#Bcwc mode -> OCV mode
setExtractRCMode -engine postRoute
setAnalysisMode -analysisType onChipVariation -cppr both
setDelayCalMode -engine default -siAware true
# setAnalysisMode -analysisType onChipVariation -cppr none
# setDelayCalMode -siAware false
optDesign -postRoute -setup
optDesign -postRoute -hold

timeDesign -postRoute -outDir $REPORT_DIR/route/postRoute_time

#setOptMode -holdTargetSlack 0.3  #when wrong route

#editDelete -use signal
#fcroute Flip chip routing Bump:han qiu
#setAttribute -net $net -shield VSS -preferred_extra_space 2
#set net {}
#selectNet $net
#globalDetailRoute -select
##delete violation
##19版: editDeleteViolation
##20版: editDelete -regular_wire_with_drc
#proc hq_fix_shorts {} {
#setMultiCpuUsage -localCpu 16
##fix short
#set db current_design .markers -if {.subtype == Metal_Short} -foreach {
#    set box [get_db $object .bbox]
#    set layer_name [get_db $object .layer_name]
#    select obj [get_db [dbQuery -area $box -layers $layer_name -objType wire] -if {.net.use != clock}]
#    editDelete -selected
#}
#}
#define proc arguments hq_fix_shorts -info "Fix shorts based on DRC results"
