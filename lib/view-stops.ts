// Where Escape on a bare board takes you (lib/use-escape-view.ts): three stops in a ring, Simple → Board → List →
// Simple. Simple is regular mode, the sidebar command center (docs/architecture/simple-mode.md); Board and List are
// advanced mode with the board's own view, its columns or one list.
import { boardMode, setBoardMode, setViewMode, viewMode, type ViewMode } from "./board-prefs";

export type ViewStop = "simple" | ViewMode;

const RING: readonly ViewStop[] = ["simple", "board", "list"];

export function nextStop(stop: ViewStop): ViewStop {
  return RING[(RING.indexOf(stop) + 1) % RING.length] ?? "simple";
}

// The stop the board is on now, read from its prefs.
export function currentStop(): ViewStop {
  return boardMode() === "regular" ? "simple" : viewMode();
}

// Puts the board on a stop: regular for Simple, else advanced with that view.
export function applyStop(stop: ViewStop) {
  if (stop === "simple") {
    setBoardMode("regular");
    return;
  }
  setBoardMode("advanced");
  setViewMode(stop);
}
