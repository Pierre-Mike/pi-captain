/**
 * FreeCAD Extension for pi
 *
 * Registers a `freecad` tool that lets Claude drive the FreeCAD agent
 * (create geometry, open/save documents, batch-export files) via the
 * shell wrapper at skills/freecad/freecad_run.sh.
 *
 * The FreeCAD Python environment is fully self-contained inside the macOS
 * app bundle — no extra setup required beyond having FreeCAD installed at
 * /Applications/FreeCAD.app.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { allFreecadTools } from "./tools.js";

export default function freecadExtension(pi: ExtensionAPI) {
	// Register all FreeCAD tools
	for (const tool of allFreecadTools) {
		pi.registerTool(tool);
	}
}
