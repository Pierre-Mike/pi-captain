---
name: freecad
description: >
  Drive FreeCAD from pi to create 3D geometry, open and modify .FCStd files,
  batch-export to STEP/IGES/STL/DXF, and run natural language CAD commands.
  Use when the user asks to: create a 3D shape (box, cylinder, sphere), open or
  save a FreeCAD document, export .FCStd files to another format, batch-convert
  a folder of FreeCAD models, write FreeCAD Python scripts, or work with
  parametric/marine CAD models. The FreeCAD agent lives at
  skills/freecad/ and is exposed through five pi tools registered by the
  freecad extension: freecad_capabilities, freecad_prompt, freecad_create,
  freecad_export, and freecad_batch.
---

# FreeCAD Skill

## Available pi tools

| Tool | What it does |
|------|-------------|
| `freecad_capabilities` | Confirm FreeCAD is available; list capabilities |
| `freecad_prompt` | Run a natural language command ("Create a box 100x50x25") |
| `freecad_create` | Create a box/cylinder/sphere and save to `.FCStd` |
| `freecad_export` | Open a `.FCStd` and export to STEP / IGES / STL / DXF / PDF |
| `freecad_batch` | Batch-export all `.FCStd` files in a directory |

## Core concepts

### Always create a document before creating objects

The agent requires an active document. `freecad_create` handles this automatically. When writing Python scripts against `FreeCADAPIWrapper` directly:

```python
agent.new_document("MyPart")   # ← required first
result = agent.create_box(100, 50, 25)
agent.save_document("/tmp/part.FCStd")
```

### Always call `doc.recompute()` after adding objects

FreeCAD never recomputes automatically. The wrapper calls it internally, but raw scripts must do it explicitly:

```python
obj = doc.addObject("Part::Feature", "Box")
obj.Shape = Part.makeBox(100, 50, 25)
doc.recompute()          # ← mandatory, not optional
```

### Part vs PartDesign — pick one, don't mix

- **Part workbench** — CSG-based, flexible scripting, boolean ops, multiple solids. Use for programmatic geometry.
- **PartDesign workbench** — Feature-based (Pad, Pocket), requires a `Body` container, single contiguous solid. PartDesign scripting does not work with Part objects and vice versa.

### Headless vs GUI

The agent always runs headless (`FreeCADCmd`). Never import `FreeCADGui` or use view providers — they don't exist headlessly. The wrapper's mock fallback lets code run in dev even without FreeCAD installed.

## Quick examples

```bash
# Natural language
freecad_prompt: "Create a cylinder radius 30 height 80"

# Explicit shape
freecad_create shape=box dimensions=[200,100,50] output_dir=/tmp

# Export existing file
freecad_export input_file=hull.FCStd output_file=hull.step format=STEP

# Batch export a folder
freecad_batch directory=./models pattern=*.FCStd
```

## Running the agent directly (without pi tools)

```bash
# Requires FreeCAD.app at /Applications/FreeCAD.app
skills/freecad/freecad_run.sh --show-capabilities
skills/freecad/freecad_run.sh --prompt "Create a box 100 50 25"
skills/freecad/freecad_run.sh --create box --dimensions 100 50 25 --output /tmp
skills/freecad/freecad_run.sh --file model.FCStd --export model.step --format STEP
skills/freecad/freecad_run.sh --batch --pattern "*.FCStd" --input-directory ./models
```

## Reference files

- `rules/python-scripting.md` — Raw FreeCAD Python API patterns (when extending `src/api/wrapper.py`)
- `rules/export-formats.md` — Format fidelity tradeoffs (STEP vs STL vs DXF)
- `rules/marine-engineering.md` — Hull, mooring, FEM preprocessing patterns
