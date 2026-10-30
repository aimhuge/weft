"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_LAYOUT,
  dragDivider,
  fillColumn,
  fitToWidth,
  type Layout,
  parse,
  serialize,
  setOpen,
  toggleColumn,
} from "./workspace-layout";

// The four-column workspace for an open card (lib/workspace-layout.ts): which columns are open,
// how wide each is. The layout lives in localStorage so reloads and reopened cards keep the same
// arrangement. The board reads it through useSyncExternalStore (see lib/board-prefs.ts for the same
// shape with cookies) so every workspace component stays in sync.

const STORAGE_KEY = "weft-workspace-layout";

function readStored(): Layout {
  try {
    return parse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? ""));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function writeStored(layout: Layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(layout)));
  } catch {}
}

let current = DEFAULT_LAYOUT;
const listeners = new Set<() => void>();

// Read once on first access; the snapshot stabilizes after that so useSyncExternalStore doesn't
// re-emit when nothing changed.
function ensureLoaded() {
  if (current === DEFAULT_LAYOUT) current = readStored();
}

function subscribe(listener: () => void) {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Layout {
  ensureLoaded();
  return current;
}

// Server-render fallback (SSR / test) starts at the default; the client hydrates from localStorage.
function getServerSnapshot(): Layout {
  return DEFAULT_LAYOUT;
}

function commit(next: Layout) {
  if (next === current) return;
  current = next;
  writeStored(next);
  for (const listener of listeners) listener();
}

export interface UseWorkspaceLayout {
  layout: Layout;
  // Which column takes the leftover space (lib/workspace-layout.ts fillColumn).
  fill: ReturnType<typeof fillColumn>;
  // Open or close `id`; the last open column can't be closed.
  toggle: (id: Parameters<typeof toggleColumn>[1]) => void;
  setOpen: (id: Parameters<typeof setOpen>[1], open: boolean) => void;
  // Resize: moves the divider between `leftId` and `rightId` by `dx` pixels. The non-fill side's
  // width changes; the fill's follows automatically. `containerWidth` is the framed window's inner
  // width at the time of the drag.
  dragDivider: (leftId: Parameters<typeof dragDivider>[1], rightId: Parameters<typeof dragDivider>[2], dx: number, containerWidth: number) => void;
  // Shrink fixed columns (never below min) so the layout fits `containerWidth` with at least the
  // fill column's min. The board calls this on every window resize.
  fitToContainer: (containerWidth: number) => void;
  // Resets to DEFAULT_LAYOUT (used as a last-resort recovery; not exposed in the UI today).
  reset: () => void;
  // The divider is being dragged: the workspace passes this to BrowserPane so it hides while the
  // pointer is captured (the native Electron view swallows events otherwise).
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
}

export function useWorkspaceLayout(): UseWorkspaceLayout {
  const layout = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [dragging, setDragging] = useState(false);

  // Every writer reads the store's latest layout, not this render's. A closed-over `layout` would
  // write a stale copy back: a resize report still holding the layout from before a card opened put
  // the pane column back to closed. A divider's pointermove handler, bound once at pointerdown,
  // would apply every move to the pointerdown layout, and the column would only move a few pixels.
  const toggle = useCallback(
    (id: Parameters<typeof toggleColumn>[1]) => commit(toggleColumn(getSnapshot(), id)),
    [],
  );
  const setOpenCol = useCallback(
    (id: Parameters<typeof setOpen>[1], open: boolean) => commit(setOpen(getSnapshot(), id, open)),
    [],
  );
  const drag = useCallback(
    (leftId: Parameters<typeof dragDivider>[1], rightId: Parameters<typeof dragDivider>[2], dx: number, containerWidth: number) =>
      commit(dragDivider(getSnapshot(), leftId, rightId, dx, containerWidth)),
    [],
  );
  const fit = useCallback((containerWidth: number) => commit(fitToWidth(getSnapshot(), containerWidth)), []);
  const reset = useCallback(() => commit(DEFAULT_LAYOUT), []);

  return {
    layout,
    fill: fillColumn(layout),
    toggle,
    setOpen: setOpenCol,
    dragDivider: drag,
    fitToContainer: fit,
    reset,
    dragging,
    setDragging,
  };
}
