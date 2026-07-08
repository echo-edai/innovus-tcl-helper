#=============================================================================
# 阶段 7：布线 (Routing)
# 说明：执行全局布线和详细布线，配置 SI 分析、天线效应修复等。
#=============================================================================

cus_report_separator "阶段 7: 布线"

cus_ensure_dir "${REPORT_DIR}/route"

#--------------
# 早期全局布线 (Early Global Route)
# 用于估计布线资源和拥塞
#--------------
setRouteMode \
    -earlyGlobalMaxRouteLayer $TOP_LAYER_NUM \
    -earlyGlobalMinRouteLayer $BOTTOM_LAYER_NUM
earlyGlobalRoute

#--------------
# 寄生参数提取 (RC Extraction)
#--------------
reset_parasitics
extractRC

#--------------
# NanoRoute 详细布线配置
#--------------
# 时序驱动布线
setNanoRouteMode -routeWithTimingDriven true

# 多孔优化
setNanoRouteMode -drouteUseMultiCutViaEffort  high
setNanoRouteMode -routeReserveSpaceForMultiCut true
setNanoRouteMode -droutePostRouteSwapViaPriority auto
setNanoRouteMode -droutePostRouteSwapVia multiCut

# 过孔权重
setNanoRouteMode -dbAdjustAutoViaWeight true
setNanoRouteMode -dbViaWeight {vianame weight}

# SI 串扰分析
setDelayCalMode -siAware true -engine aae

# 天线效应修复
setNanoRouteMode -drouteFixAntenna true \
    -routeAntennaCellName ANTENNA \
    -routeInsertAntennaDiode true

# 线扩展优化（改善 setup）
setNanoRouteMode -drouteMinSlackForWireOptimization 0.1
setNanoRouteMode -droutePostRouteSpreadWire true
setNanoRouteMode -droutePostRouteWidenWire true

# 高级搜索修复
setNanoRouteMode -drouteExpAdvancedSearchFix true

# 电源条纹层范围
setNanoRouteMode -routeStripeLayerRange 4:8

#--------------
# UPF: 信号级 PG 连接
#--------------
if {$UPF_FLOW} {
    setPGPinUseSignalRoute -all
    # routePGPinUseSignalRoute -all -nets {<secondary_pg_nets>}
}

#--------------
# 执行 NanoRoute 详细布线
#--------------
routeDesign

#--------------
# 布线后寄生提取
#--------------
reset_parasitics
extractRC

#--------------
# 布线后时序
#--------------
timeDesign -postRoute -outDir $REPORT_DIR/route

cus_save "7_route"
puts "✅ 7_route.tcl — 布线完成"
