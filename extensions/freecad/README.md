# 🔧 FreeCAD

Drive FreeCAD from pi with natural language. Create 3D shapes, open and modify `.FCStd` files, export to STEP/IGES/STL/DXF, and batch-convert entire folders — all without leaving the terminal.

## Install

```bash
pi install npm:pi-freecad
```

## Requirements

- [FreeCAD](https://www.freecad.org) installed at `/Applications/FreeCAD.app` (macOS). The Python environment is fully self-contained inside the app bundle — no extra setup required.

## What it does

Registers five tools that wrap the FreeCAD Python agent. The agent runs headlessly via the bundled `freecad_run.sh` shell script and communicates results back to pi.

## Tools

| Tool | Description |
|---|---|
| `freecad_capabilities` | Show what the FreeCAD agent can do and confirm FreeCAD is available |
| `freecad_prompt` | Execute a natural language CAD command, e.g. `Create a box 100x50x25` |
| `freecad_create` | Create a basic 3D shape (box, cylinder, sphere) and save to a `.FCStd` file |
| `freecad_export` | Open an existing `.FCStd` file and export it to STEP, IGES, STL, DXF, or PDF |
| `freecad_batch` | Batch-process all `.FCStd` files matching a glob pattern in a directory |

## Examples

```
Create a cylinder with radius 30 and height 80
Export /models/part.FCStd to STEP
Batch export all .FCStd files in /models/ to STL
```

## Bundled skill

The extension ships with a `skill/SKILL.md` and supporting agent configuration that is automatically loaded into the session. It includes rules for CAD engineering best practices, export formats, marine engineering patterns, and FreeCAD Python scripting.
