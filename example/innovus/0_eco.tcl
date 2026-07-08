proc cus_routeUnconnected {} {
    clearDrc
    deselectAll

    # 报告所有 open net
    verifyConnectivity -type regular -noAntenna -noWeakConnect -noUnConnPin -noSoftPGConnect -error 1000 -warning 50

    # 利用 DRC Marker 获取相关信息
    set net_markers [dbGet top.markers.message]
    set net_len [llength $net_markers]
    set net_names [lindex $net_markers 1]

    for {set x 3} {$x < $net_len} {set x [expr {$x + 2}]} {
        lappend net_names [lindex $net_markers $x]
    }

    set netNames [lsort -unique $net_names]
    set file1 [open unrouted_nets_1.rpt w]
    foreach a $netNames {
        selectNet $a
        puts $file1 "dangling net \t $a \t is selected for re-routing"
    }
    close $file1

    clearDrc

    # 设置只对选中的 net 进行 routing
    setNanoRouteMode -routeSelectedNetOnly true
    globalDetailRoute

    # 布线结束后 reset nanoroute 选项
    setNanoRouteMode -routeSelectedNetOnly false
    deselectAll
}
