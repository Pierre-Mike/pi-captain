#!/bin/bash
# FreeCAD runner — executes the FreeCAD agent with the correct Python environment.
# Usage:
#   freecad_run.sh --show-capabilities
#   freecad_run.sh --prompt "Create a box 100x50x25"
#   freecad_run.sh --create box --dimensions 100 50 25 --output /tmp
#   freecad_run.sh --file model.FCStd --export model.step
#   freecad_run.sh --batch --pattern "*.FCStd" --input-directory ./models

FREECAD_APP="/Applications/FreeCAD.app/Contents/Resources"
FREECAD_PYTHON="$FREECAD_APP/bin/python"
AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$FREECAD_PYTHON" ]; then
  echo "ERROR: FreeCAD not found at $FREECAD_APP"
  echo "Install FreeCAD from https://www.freecad.org or update FREECAD_APP path in this script."
  exit 1
fi

exec env PYTHONPATH="$FREECAD_APP/lib:$AGENT_DIR" \
  "$FREECAD_PYTHON" "$AGENT_DIR/run_freecad_agent.py" "$@"
