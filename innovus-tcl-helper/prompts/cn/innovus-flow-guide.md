---
name: innovus-flow-guide
description: Innovus 芯片物理设计流程参考。Use when understanding Innovus design flow stages, command sequences, and typical parameters for each stage. Covers: floorplan, powerplan, placement, CTS, routing, verification, timing. Triggers: Innovus flow, design stages, floorplan steps, CTS setup, routing flow, power plan, what commands to use for, Innovus recipe.
---

# Innovus 设计流程参考 Skill

你是 Innovus 物理设计流程专家。你知道每个设计阶段的典型命令、参数和最佳实践。

## 标准流程总览

```
0_setenv     → 1_init      → 2_floorplan → 3_powerplan
环境变量       设计初始化     布图规划       电源规划

4_placement  → 5_opt       → 6_CTS       → 7_route
布局           优化           时钟树综合     布线

8_verify     → 9_report    → 10_outfiles
验证           报告           输出文件
```

---

## 阶段 0：环境设置 (0_setenv.tcl)

**目的**：定义全局变量，后续所有阶段引用

```tcl
# ── 目录路径 ──
set SCRIPTS_DIR   "./scripts"
set REPORT_DIR    "./reports"
set OUTPUT_DIR    "./outputs"

# ── 工艺库 ──
set TECH_LEF_PATH "/path/to/tech.lef"
set CELL_LEF      "/path/to/cell.lef"
set LIB_FILE      "/path/to/lib.lib"

# ── 网表 ──
set NETLIST_FILE  "/path/to/netlist.v"
set TOP_CELL      "top_design"

# ── 层定义（关键！后续 addRing/addStripe 使用） ──
set TOP_LAYER     "M5"
set BOTTOM_LAYER  "M1"
set LEFT_LAYER    "M3"
set RIGHT_LAYER   "M3"

# ── 电源网络 ──
set VDD_PIN       "VDD"
set VSS_PIN       "VSS"

# ── 宏单元尺寸 ──
set macro_site_width  0.5
set macro_site_height 2.0
```

**关键变量命名约定**：
- `init_*` 开头的变量由 `init_design` 自动读取
- `*_LAYER` 变量用于 `addRing`/`addStripe` 的层指定
- `*_PIN` 变量用于电源网络连接

---

## 阶段 1：设计初始化 (1_init.tcl)

**目的**：加载工艺库、网表，设置 MMMC

```tcl
# Innovus 通过变量名约定读取配置
set init_verilog       $NETLIST_FILE
set init_design_netlisttype "verilog"
set init_design_settop  1
set init_top_cell      $TOP_CELL
set init_lef_file      [list $TECH_LEF_PATH $CELL_LEF]
set init_pwr_net       $VDD_PIN
set init_gnd_net       $VSS_PIN
set init_mmmc_file     "mmmc.tcl"

# 初始化设计
init_design
```

**常用 init_* 变量**：
| 变量 | 说明 |
|------|------|
| `init_verilog` | 网表文件路径 |
| `init_lef_file` | LEF 库文件列表 |
| `init_top_cell` | 顶层模块名 |
| `init_pwr_net` | 电源网络名 |
| `init_gnd_net` | 地网络名 |
| `init_mmmc_file` | MMMC 配置 |
| `init_cpf_file` | CPF/UPF 电源意图文件 |
| `init_io_file` | IO 引脚分配文件 |

---

## 阶段 2：布图规划 (2_floorplan.tcl)

**目的**：定义芯片尺寸、放置宏单元、创建边界

```tcl
# 设置布图参数
set fp_core_cntl      1.0
set fp_aspect_ratio   1.0
set fp_core_util      0.7

# 创建布图
floorPlan -site $MACRO_SITE \
    -r $fp_aspect_ratio \
    $fp_core_cntl \
    0 0 0 0 \
    0 0 0 0

# 放置宏单元
placeInstance macro_1 100 200 R0
placeInstance macro_2 500 200 R0

# 添加 Halo
addHaloToBlock 5 5 5 5 -allBlocks
```

**常用命令**：
| 命令 | 说明 |
|------|------|
| `floorPlan` | 创建芯片布图 |
| `placeInstance` | 放置单个实例 |
| `addHaloToBlock` | 块周围留间距 |
| `createPlaceBlockage` | 创建布局障碍 |
| `addEndCap` | 添加行末端单元 |
| `addWellTap` | 添加阱接触单元 |

---

## 阶段 3：电源规划 (3_powerplan.tcl)

**目的**：创建电源环和条纹，连接全局网络

```tcl
# 电源环
addRing -center 1 \
    -nets [list $VDD_PIN $VSS_PIN] \
    -type core_rings \
    -layer [list top $TOP_LAYER bottom $BOTTOM_LAYER \
                  left $LEFT_LAYER right $RIGHT_LAYER] \
    -width [expr $macro_site_width * 10] \
    -spacing [expr $macro_site_width * 5] \
    -offset [expr $macro_site_width * 20]

# 电源条纹
addStripe -nets [list $VDD_PIN $VSS_PIN] \
    -layer $TOP_LAYER \
    -direction vertical \
    -width [expr $macro_site_width * 5] \
    -spacing [expr $macro_site_width * 3] \
    -set_to_set_distance [expr $macro_site_width * 40]

# 全局网络连接
globalNetConnect $VDD_PIN -type pgpin -pin $VDD_PIN -inst *
globalNetConnect $VSS_PIN -type pgpin -pin $VSS_PIN -inst *
globalNetConnect $VDD_PIN -type tiehi
globalNetConnect $VSS_PIN -type tielo

# 电源布线
sroute -connect { blockPin padPin padRing corePin floatingStripe }
```

**常用命令**：
| 命令 | 说明 |
|------|------|
| `addRing` | 电源/地环线 |
| `addStripe` | 电源/地条纹 |
| `globalNetConnect` | 全局网络连接 |
| `sroute` | 标准单元电源布线 |
| `editPowerVia` | 添加电源通孔 |
| `addPGFTV` | 添加电源填充单元 |

---

## 阶段 4：布局 (4_placement.tcl)

**目的**：自动布局标准单元

```tcl
# 布局前设置
setPlaceMode -place_global_clock_gate_aware true

# 执行布局
place_design

# 优化布局
refinePlace
```

---

## 阶段 5：优化 (5_opt.tcl)

**目的**：时序和面积优化

```tcl
setOptMode -fixDRC true -fixFanoutLoad true
optDesign -preCTS
```

---

## 阶段 6：时钟树综合 (6_CTS.tcl)

**目的**：构建时钟树

```tcl
# 创建时钟树规格
create_ccopt_clock_tree_spec -file ccopt.spec

# 时钟树综合
ccopt_design -cts

# 时钟树布线
route_ccopt_clock_tree_nets
```

---

## 阶段 7：布线 (7_route.tcl)

**目的**：全局和详细布线

```tcl
setRouteMode -earlyGlobalRoute true
routeDesign
```

---

## 阶段 8-9：验证和报告

```tcl
# 验证
verify_drc
verifyConnectivity -type all

# 报告
report_timing -max_paths 100 -slack_lesser_than 0
report_area
report_power
```

---

## 快速参考：按需求查命令

| 需求 | 命令 |
|------|------|
| 创建芯片区域 | `floorPlan` |
| 放置标准单元 | `place_design` |
| 创建电源环 | `addRing -type core_rings` |
| 创建电源条纹 | `addStripe` |
| 电源布线 | `sroute` |
| 全局网络连接 | `globalNetConnect` |
| 加载设计 | `init_design` |
| 加载网表 | `init_verilog` 变量 + `init_design` |
| 时序优化 | `optDesign` |
| 时钟树 | `ccopt_design` |
| 全局布线 | `routeDesign` |
| DRC 检查 | `verify_drc` |
| 连接性检查 | `verifyConnectivity` |
| 时序报告 | `report_timing` |
| 面积报告 | `report_area` |
| 导出 DEF | `defOut` |
| 导出网表 | `saveNetlist` |
| 保存设计 | `saveDesign` |
