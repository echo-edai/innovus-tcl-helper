/**
 * Lint Provider — TCL 跨文件静态检查
 *
 * 基于 TclCompiler 编译结果生成 VS Code Diagnostics，
 * 并提供 MCP 可用的 Lint 报告接口。
 *
 * 检查项:
 *   1. 未定义变量引用
 *   2. 变量使用在定义之前（顺序警告）
 *   3. 文件不存在（.f 文件中引用的文件）
 *   4. source 引用的文件不存在
 *   5. 变量重复赋值但不使用
 *   6. proc 定义但未被调用
 *   7. 空 set 命令（set var 无值）
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { TclCompiler, CompileResult, VariableInfo, CompileError, CompileWarning } from './compiler';

// ════════════════════════════════════════════════════════════
//  配置
// ════════════════════════════════════════════════════════════

const DIAGNOSTIC_SOURCE = 'innovus-tcl-lint';

/** Lint 严格程度 */
export type LintLevel = 'basic' | 'standard' | 'strict';

// ════════════════════════════════════════════════════════════
//  Lint Provider
// ════════════════════════════════════════════════════════════

export class TclLintProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private compiler: TclCompiler;
    private lastResult: CompileResult | null = null;
    private workspaceRoot: string = '';

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
        this.compiler = new TclCompiler();
    }

    /** 获取编译器实例 */
    getCompiler(): TclCompiler {
        return this.compiler;
    }

    /** 获取最近一次编译结果 */
    getLastResult(): CompileResult | null {
        return this.lastResult;
    }

    /** 获取工作区根目录 */
    getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    /** 获取当前 lint 级别 */
    private getLevel(): LintLevel {
        return vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('diagnosticLevel', 'standard') as LintLevel;
    }

    /** 获取 .f 文件路径配置 */
    private getFFilePath(): string {
        return vscode.workspace.getConfiguration('innovus-tcl')
            .get<string>('fFile', 'tcl.f');
    }

    /** 检查是否启用跨文件编译分析 */
    private isCompilationEnabled(): boolean {
        return vscode.workspace.getConfiguration('innovus-tcl')
            .get<boolean>('enableCompilation', true);
    }

    /**
     * 对整个项目进行 Lint 分析。
     * 需要工作区已经打开。
     */
    runLint(document?: vscode.TextDocument): void {
        if (!this.isCompilationEnabled()) {
            this.diagnosticCollection.clear();
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        const fFile = this.getFFilePath();
        const level = this.getLevel();

        // 编译项目
        this.lastResult = this.compiler.compile(this.workspaceRoot, fFile);

        // 生成诊断信息
        const allDiagnostics = new Map<string, vscode.Diagnostic[]>();

        // 收集每个文件的诊断
        for (const error of this.lastResult.errors) {
            this.addDiagnostic(allDiagnostics, error.filePath,
                this.createDiagnostic(error, vscode.DiagnosticSeverity.Error));
        }

        if (level !== 'basic') {
            for (const warning of this.lastResult.warnings) {
                this.addDiagnostic(allDiagnostics, warning.filePath,
                    this.createDiagnostic(warning, vscode.DiagnosticSeverity.Warning));
            }
        }

        // strict 级别：检查未使用的变量
        if (level === 'strict') {
            this.checkUnusedVariables(allDiagnostics);
            this.checkUnusedProcs(allDiagnostics);
        }

        // 应用诊断到所有文件
        this.diagnosticCollection.clear();

        for (const [filePath, diagnostics] of allDiagnostics) {
            const uri = vscode.Uri.file(filePath);
            this.diagnosticCollection.set(uri, diagnostics);
        }

        // 如果指定了 document，确保该文件的诊断也被更新
        if (document) {
            const existing = allDiagnostics.get(document.uri.fsPath) || [];
            this.diagnosticCollection.set(document.uri, existing);
        }
    }

    /**
     * 增量 Lint：单个文件保存时触发。
     */
    runIncrementalLint(document: vscode.TextDocument): void {
        if (!this.isCompilationEnabled() || !this.lastResult) {
            this.runLint(document);
            return;
        }

        const content = document.getText();
        const filePath = document.uri.fsPath;

        // 增量更新编译结果
        this.lastResult = this.compiler.incrementalUpdate(filePath, content, this.lastResult);

        // 重新生成此文件的诊断
        const diagnostics: vscode.Diagnostic[] = [];

        for (const error of this.lastResult.errors) {
            if (error.filePath === filePath) {
                diagnostics.push(this.createDiagnostic(error, vscode.DiagnosticSeverity.Error));
            }
        }

        for (const warning of this.lastResult.warnings) {
            if (warning.filePath === filePath) {
                diagnostics.push(this.createDiagnostic(warning, vscode.DiagnosticSeverity.Warning));
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /** 清除所有诊断 */
    clear(): void {
        this.diagnosticCollection.clear();
        this.lastResult = null;
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }

    // ════════════════════════════════════════════════════════
    //  私有辅助方法
    // ════════════════════════════════════════════════════════

    private addDiagnostic(
        map: Map<string, vscode.Diagnostic[]>,
        filePath: string,
        diagnostic: vscode.Diagnostic
    ): void {
        const existing = map.get(filePath);
        if (existing) {
            existing.push(diagnostic);
        } else {
            map.set(filePath, [diagnostic]);
        }
    }

    private createDiagnostic(
        item: { message: string; filePath: string; line: number; column: number },
        severity: vscode.DiagnosticSeverity
    ): vscode.Diagnostic {
        const line = Math.max(0, item.line - 1);
        const col = Math.max(0, item.column - 1);

        const range = new vscode.Range(line, col, line, col + 1);
        const diag = new vscode.Diagnostic(range, item.message, severity);
        diag.source = DIAGNOSTIC_SOURCE;
        return diag;
    }

    /** 检查未使用的变量 */
    private checkUnusedVariables(diagnosticsMap: Map<string, vscode.Diagnostic[]>): void {
        if (!this.lastResult) { return; }

        for (const [varName, defs] of this.lastResult.variables) {
            // 检查每个定义是否有对应的引用
            const refs = this.lastResult.variableRefs.filter(r => r.name === varName);
            if (refs.length === 0 && defs.length > 0) {
                const lastDef = defs[defs.length - 1];
                const diag = new vscode.Diagnostic(
                    new vscode.Range(lastDef.line - 1, lastDef.column - 1,
                        lastDef.line - 1, lastDef.column + lastDef.name.length),
                    `变量 "${varName}" 已定义但从未使用`,
                    vscode.DiagnosticSeverity.Information
                );
                diag.source = DIAGNOSTIC_SOURCE;
                this.addDiagnostic(diagnosticsMap, lastDef.filePath, diag);
            }
        }
    }

    /** 检查未使用的 proc */
    private checkUnusedProcs(diagnosticsMap: Map<string, vscode.Diagnostic[]>): void {
        if (!this.lastResult) { return; }

        const allCommandNames = new Set<string>();
        for (const unit of this.lastResult.units) {
            for (const cmd of unit.parseResult.commands) {
                allCommandNames.add(cmd.commandName);
            }
        }

        for (const unit of this.lastResult.units) {
            for (const proc of unit.procs) {
                if (!allCommandNames.has(proc.procName)) {
                    const diag = new vscode.Diagnostic(
                        new vscode.Range(proc.line - 1, proc.column - 1,
                            proc.line - 1, proc.column + proc.procName.length + 4),
                        `过程 "${proc.procName}" 已定义但从未被调用`,
                        vscode.DiagnosticSeverity.Information
                    );
                    diag.source = DIAGNOSTIC_SOURCE;
                    this.addDiagnostic(diagnosticsMap, unit.filePath, diag);
                }
            }
        }
    }

    // ════════════════════════════════════════════════════════
    //  MCP 接口：Lint 报告
    // ════════════════════════════════════════════════════════

    /**
     * 生成 Lint 报告（用于 MCP 工具返回）。
     * @param format 输出格式 "text" | "json"
     */
    generateLintReport(format: 'text' | 'json' = 'text'): string {
        if (!this.lastResult) {
            return JSON.stringify({ error: '没有编译结果。请先运行 Lint 分析。' });
        }

        if (format === 'json') {
            return this.generateJsonReport();
        }
        return this.generateTextReport();
    }

    private generateTextReport(): string {
        const r = this.lastResult!;
        const isZh = true;
        const lines: string[] = [];

        lines.push(`# Innovus TCL Lint 报告`);
        lines.push(``);
        lines.push(`**工作区**: ${r.workspaceRoot}`);
        lines.push(`**编译文件**: ${r.fFilePath}`);
        lines.push(`**文件数量**: ${r.units.length}`);
        lines.push(`**变量定义数**: ${Array.from(r.variables.values()).reduce((s, v) => s + v.length, 0)}`);
        lines.push(`**变量引用数**: ${r.variableRefs.length}`);
        lines.push(`**错误数**: ${r.errors.length}`);
        lines.push(`**警告数**: ${r.warnings.length}`);
        lines.push(``);

        // 编译顺序
        lines.push(`## 📋 编译文件列表`);
        lines.push(``);
        for (const unit of r.units) {
            lines.push(`- \`${unit.relativePath}\` (${unit.sets.length} 个变量定义)`);
        }
        lines.push(``);

        // 变量表
        lines.push(`## 📊 全局变量表`);
        lines.push(``);
        if (r.variables.size === 0) {
            lines.push(`*(无变量定义)*`);
        } else {
            lines.push(`| 变量名 | 值 | 定义位置 |`);
            lines.push(`|--------|-----|---------|`);
            for (const [varName, defs] of r.variables) {
                for (const def of defs) {
                    const val = def.value.length > 40
                        ? def.value.substring(0, 37) + '...'
                        : def.value || '*(空)*';
                    lines.push(`| \`${varName}\` | ${val} | ${def.relativePath}:${def.line} |`);
                }
            }
        }
        lines.push(``);

        // 错误
        if (r.errors.length > 0) {
            lines.push(`## ❌ 错误 (${r.errors.length})`);
            lines.push(``);
            for (const err of r.errors) {
                const relPath = path.relative(r.workspaceRoot, err.filePath);
                lines.push(`- **${relPath}:${err.line}** — ${err.message}`);
            }
            lines.push(``);
        }

        // 警告
        if (r.warnings.length > 0) {
            lines.push(`## ⚠️ 警告 (${r.warnings.length})`);
            lines.push(``);
            for (const warn of r.warnings) {
                const relPath = path.relative(r.workspaceRoot, warn.filePath);
                lines.push(`- **${relPath}:${warn.line}** — ${warn.message}`);
            }
            lines.push(``);
        }

        if (r.errors.length === 0 && r.warnings.length === 0) {
            lines.push(`## ✅ 无问题`);
            lines.push(``);
            lines.push(`所有文件编译通过，未发现语法错误或未定义变量。`);
        }

        return lines.join('\n');
    }

    private generateJsonReport(): string {
        const r = this.lastResult!;

        // 构建可序列化的报告
        const report: any = {
            workspaceRoot: r.workspaceRoot,
            fFilePath: r.fFilePath,
            fileCount: r.units.length,
            variableDefCount: Array.from(r.variables.values()).reduce((s, v) => s + v.length, 0),
            variableRefCount: r.variableRefs.length,
            errorCount: r.errors.length,
            warningCount: r.warnings.length,
            files: r.units.map(u => ({
                path: u.relativePath,
                order: u.order,
                setCount: u.sets.length,
                varRefCount: u.varRefs.length,
                sourceCount: u.sources.length,
                procCount: u.procs.length,
                commandCount: u.parseResult.commands.length
            })),
            variables: {} as Record<string, any[]>,
            errors: r.errors.map(e => ({
                message: e.message,
                file: path.relative(r.workspaceRoot, e.filePath),
                line: e.line,
                column: e.column
            })),
            warnings: r.warnings.map(w => ({
                message: w.message,
                file: path.relative(r.workspaceRoot, w.filePath),
                line: w.line,
                column: w.column
            }))
        };

        for (const [varName, defs] of r.variables) {
            report.variables[varName] = defs.map(d => ({
                value: d.value,
                rawValue: d.rawValue,
                file: d.relativePath,
                line: d.line,
                order: d.order,
                isResolved: d.isResolved
            }));
        }

        return JSON.stringify(report, null, 2);
    }

    /**
     * 查询变量信息（MCP 接口）。
     */
    queryVariable(varName: string, filePath?: string, line?: number): {
        found: boolean;
        definition: VariableInfo | null;
        allDefinitions: VariableInfo[];
        references: { file: string; line: number; column: number }[];
    } {
        if (!this.lastResult) {
            return { found: false, definition: null, allDefinitions: [], references: [] };
        }

        const r = this.lastResult;
        // 将相对路径转换为绝对路径
        let absPath = filePath;
        if (filePath && !path.isAbsolute(filePath)) {
            absPath = path.resolve(r.workspaceRoot, filePath);
        }

        const { definition, allDefs, refs } =
            this.compiler.queryVariable(varName, r, absPath, line);

        return {
            found: allDefs.length > 0 || refs.length > 0,
            definition,
            allDefinitions: allDefs,
            references: refs.map(rf => ({
                file: rf.relativePath,
                line: rf.line,
                column: rf.column
            }))
        };
    }
}
