proc cus_get_ports { port } {
    get_db [get_ports *] .name $port
}

proc cus_get_pins { pin } {
    get_db [get_pins *] .name $pin
}

proc cus_add_port { name } {
    editPin -spreadType EDGE layer -M4 -pinWidth 0.2 -pinDepth 1 -edge 2 -pin $name offsetStart 100
}

proc cus_report_text {} {
    editSelect -shape FOLLOWPIN
    foreach tmp [dbGet selected.] {
        puts "LAYOUT TEXT [dbget $tmp.net.name] [dbget $tmp.box_llx] [dbget $tmp.box_lly] M1TXT"
    }
}

proc cus_save { name } {
    saveDesign dbs/$VERSION/$name.enc -compress
}

# 默认模板文件为 constraint.tcl.template
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

    # Step 1: 预处理 timing_block
    set timing_lines {}
    foreach lib $TIMING_LIBS {
        lappend timing_lines "    {[list $lib]}"
    }
    set timing_block [join $timing_lines " \\\n"]

    # Step 2: 从文件读取模板
    if {![file exists $TEMPLATE_FILE_PATH]} {
        error "模板文件不存在: $TEMPLATE_FILE_PATH"
    }
    set fp_in [open $TEMPLATE_FILE_PATH r]
    set script_template [read $fp_in]
    close $fp_in

    # Step 3: 执行变量替换（仅替换变量，不执行命令）
    set final_script [subst -nocommands -nobackslashes $script_template]

    # Step 4: 写入输出文件
    if {![file exist [file dirname $OUTPUT_FILE_PATH]]} {
        exec mkdir -p [file dirname $OUTPUT_FILE_PATH]
        exec touch ${OUTPUT_FILE_PATH}
        echo "Creating ${OUTPUT_FILE_PATH} !!!"
    }
    set fp_out [open $OUTPUT_FILE_PATH "w"]
    puts $fp_out $final_script
    close $fp_out

    puts "✅ 脚本已生成: $OUTPUT_FILE_PATH"
}
