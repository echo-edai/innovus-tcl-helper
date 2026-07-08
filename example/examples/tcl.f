#=============================================================================
# Innovus Flow TCL 文件列表 (.f 文件)
# 说明：每行一个 TCL 文件的相对路径，文件按编译顺序排列。
#       Innovus 按此顺序依次加载执行。
#=============================================================================

# ---------- 阶段 0：环境和工具 ----------
0_setenv.tcl
0_cmd.tcl

# ---------- 阶段 1-10：设计流程 ----------
1_init.tcl
2_floorplan.tcl
3_powerplan.tcl
4_placement.tcl
5_opt.tcl
6_CTS.tcl
7_route.tcl
8_verify.tcl
9_report.tcl
10_outfiles.tcl
