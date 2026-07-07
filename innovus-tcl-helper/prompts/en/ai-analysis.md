Analyze the Innovus TCL script `{script_name}`.

**MCP tools to use:**
Call `innovus_parse_tcl_script` to get full reference docs and parameter comparison for all Innovus commands

**Analysis requirements:**
Based on the real command docs returned by MCP tools (do NOT guess parameters), complete the following analysis and output in a Markdown code block:

```markdown
# TCL Script Analysis Report

## A. Overall Purpose
(2-3 sentences summarizing design goal and workflow)

## B. Per-Command Analysis
For each Innovus command:
- What it does in this script
- Are parameters correct (compare with docs)
- Missing required parameters
- Parameter type matching

## C. Lint Results
- Bracket/quote matching
- Command parameter completeness

## D. Flow Assessment & Suggestions
- Is execution order logical
- Optimization suggestions
- Potential risks
```
