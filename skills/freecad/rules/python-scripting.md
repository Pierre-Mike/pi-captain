# Always set up the Python path before importing FreeCAD

FreeCAD's Python bindings are bundled inside the macOS app. They are not on
the system Python path. Scripts that import `FreeCAD` directly will fail unless
the lib path is added first. The `freecad_run.sh` wrapper handles this; only
manual scripts need to do it themselves.

## Avoid

```python
import FreeCAD   # ModuleNotFoundError
```

## Prefer

```python
import sys
sys.path.insert(0, "/Applications/FreeCAD.app/Contents/Resources/lib")
import FreeCAD
```

Or use the wrapper:
```python
from src.api.wrapper import FreeCADAPIWrapper
w = FreeCADAPIWrapper()   # handles path setup via agent_config.json
```

---

# Use the mock fallback pattern for code that runs without FreeCAD

The wrapper sets `freecad_available = False` when bindings are missing and
returns `None` from all shape methods. Always check this before using results.

## Avoid

```python
obj = wrapper.create_box(100, 50, 25)
obj.Label = "MyBox"   # AttributeError if FreeCAD not available
```

## Prefer

```python
obj = wrapper.create_box(100, 50, 25)
if obj is not None:
    obj.Label = "MyBox"
```

---

# Call recompute() after every batch of shape operations

FreeCAD's parametric model does not propagate changes until `recompute()` is
called. Missing this is the single most common source of "shape is empty" bugs.

## Avoid

```python
doc.addObject("Part::Feature", "Box").Shape = Part.makeBox(100, 50, 25)
# export now — shape may be stale / empty
```

## Prefer

```python
obj = doc.addObject("Part::Feature", "Box")
obj.Shape = Part.makeBox(100, 50, 25)
doc.recompute()   # flush before export or boolean ops
```
