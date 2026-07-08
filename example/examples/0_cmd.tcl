#=============================================================================
# 阶段 0：自定义 TCL 工具函数
# 说明：定义可复用的 proc，供后续各阶段脚本调用。
#=============================================================================

#-----------------------------------------------------------------------------
# proc: cus_save
# 用途：保存设计快照到指定路径
# 参数：name — 快照名称（不含路径和扩展名）
#-----------------------------------------------------------------------------
proc cus_save { name } {
    global DB_DIR VERSION
    set save_path "$DB_DIR/${name}.enc"
    saveDesign $save_path -compress
    puts "✅ 设计已保存: $save_path"
}

#-----------------------------------------------------------------------------
# proc: cus_ensure_dir
# 用途：确保目录存在，不存在则自动创建
# 参数：dir_path — 目录绝对路径
#-----------------------------------------------------------------------------
proc cus_ensure_dir { dir_path } {
    if {![file exist $dir_path]} {
        exec mkdir -p $dir_path
        puts "✅ 目录已创建: $dir_path"
    }
}

#-----------------------------------------------------------------------------
# proc: cus_report_separator
# 用途：打印报告分隔线（增强可读性）
# 参数：title — 分隔线标题文本
#-----------------------------------------------------------------------------
proc cus_report_separator { title } {
    set line [string repeat "=" 60]
    puts "\n$line"
    puts "  $title"
    puts "$line\n"
}

#-----------------------------------------------------------------------------
# proc: cus_check_file
# 用途：检查文件是否存在，不存在则报错退出
# 参数：file_path — 文件路径; description — 文件描述（用于错误信息）
#-----------------------------------------------------------------------------
proc cus_check_file { file_path description } {
    if {![file exist $file_path]} {
        error "❌ 文件不存在 ($description): $file_path"
    }
    puts "✅ 文件检查通过 ($description): $file_path"
}

#-----------------------------------------------------------------------------
# proc: generate_constraint_script
# 用途：根据模板生成 MMMC 约束脚本（变量替换）
# 参数：
#   LIBRARY_NAME       — 工艺库名称
#   TIMING_LIBS        — 时序库文件列表
#   SDC_FILES          — SDC 约束文件路径
#   RC_WORST_CAP       — 最差 RC 拐角文件
#   WORST_TEMP         — 最差温度
#   RC_BEST_CAP        — 最佳 RC 拐角文件
#   BEST_TEMP          — 最佳温度
#   OUTPUT_FILE_PATH   — 输出 MMMC 文件路径
#   TEMPLATE_FILE_PATH — 模板文件路径（可选，默认值）
#-----------------------------------------------------------------------------
proc generate_constraint_script {
    LIBRARY_NAME
    TIMING_LIBS
    SDC_FILES
    RC_WORST_CAP
    WORST_TEMP
    RC_BEST_CAP
    BEST_TEMP
    OUTPUT_FILE_PATH
    {TEMPLATE_FILE_PATH "../input/template/template.mmmc"}
} {
    # 1) 构建时序库块
    set timing_lines {}
    foreach lib $TIMING_LIBS {
        lappend timing_lines "    {[list $lib]}"
    }
    set timing_block [join $timing_lines " \\\n"]

    # 2) 读取模板文件
    if {![file exists $TEMPLATE_FILE_PATH]} {
        error "模板文件不存在: $TEMPLATE_FILE_PATH"
    }
    set fp_in [open $TEMPLATE_FILE_PATH r]
    set script_template [read $fp_in]
    close $fp_in

    # 3) 模板变量替换（仅替换变量，不执行命令）
    set final_script [subst -nocommands -nobackslashes $script_template]

    # 4) 写入输出文件
    set out_dir [file dirname $OUTPUT_FILE_PATH]
    if {![file exist $out_dir]} {
        exec mkdir -p $out_dir
    }
    set fp_out [open $OUTPUT_FILE_PATH "w"]
    puts $fp_out $final_script
    close $fp_out

    puts "✅ MMMC 脚本已生成: $OUTPUT_FILE_PATH"
}

puts "✅ 0_cmd.tcl — 工具函数加载完成"
