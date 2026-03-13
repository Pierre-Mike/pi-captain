# Choose the export format based on downstream use

Each format has different fidelity and interoperability tradeoffs. Picking the
wrong format causes geometry loss or forces manual cleanup in the receiving tool.

## Format guide

| Format | Best for | Notes |
|--------|----------|-------|
| **STEP** | CAD-to-CAD exchange (SolidWorks, CATIA, Inventor) | Lossless B-rep; preserves topology |
| **IGES** | Legacy CAD systems | Older standard; prefer STEP when possible |
| **STL** | 3D printing, mesh-based tools | Triangulated mesh; no topology; size scales with detail |
| **DXF** | 2D drawings, AutoCAD | 2D projection only from FreeCAD's TechDraw workbench |
| **PDF** | Human-readable drawings | Non-editable; use for documentation only |

## Avoid

```bash
# Using STL for downstream CAD work
freecad_export input_file=hull.FCStd output_file=hull.stl
# → Downstream tool gets a mesh, not a solid — boolean ops fail
```

## Prefer

```bash
# Use STEP for any CAD-to-CAD exchange
freecad_export input_file=hull.FCStd output_file=hull.step format=STEP
```
