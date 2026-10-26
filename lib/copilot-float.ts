import { useSyncExternalStore } from "react";
import type { Box } from "./float-place";

// The copilot floats in the bottom-right corner of the window, like Intercom's messenger
// (components/CopilotLane.tsx): a round launcher, and above it the peek or the chat. It sits over the
// board and over every dialog, but the browser pane is a native Electron view drawn above the page, so
// nothing in the page can cover it. The open chat publishes its box here, and the pane steps aside
// (components/BrowserPane.tsx) only while the two overlap.

// The launcher: its size, its gap from the window's right edge, and from its bottom edge, which clears
// the board's footer (the usage meters and Shortcuts).
export const LAUNCHER = { size: 52, inset: 16, bottom: 44 } as const;

// The peek and the chat, both stacked above the launcher.
export const PANEL = { peek: { width: 280, height: 320 }, open: { width: 400, height: 640 } } as const;

// How far above the window's bottom edge the panels start: the launcher and a gap.
export const PANEL_BOTTOM = LAUNCHER.bottom + LAUNCHER.size + 12;

// Over the board, the card window (z-40), dialogs (z-50), Settings and the welcome (z-[90]), ⌘K
// (z-[92]), the achievement popup (z-[94]) and confetti (z-[95]); only tooltips go higher.
export const COPILOT_LAYER = "z-[96]";

// The panel's box in a window of this size: pinned to the bottom-right corner, never taller or wider
// than the window leaves room for.
export function panelBox(win: { width: number; height: number }, size: { width: number; height: number }): Box {
  const width = Math.max(0, Math.min(size.width, win.width - 2 * LAUNCHER.inset));
  const height = Math.max(0, Math.min(size.height, win.height - PANEL_BOTTOM - LAUNCHER.inset));
  return { x: win.width - LAUNCHER.inset - width, y: win.height - PANEL_BOTTOM - height, width, height };
}

// Whether two boxes share any area.
export function overlaps(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// What the copilot covers right now: the launcher's box while it's mounted, and the peek's or the chat's
// while one is up.
export type CopilotCover = { launcher: Box | null; panel: Box | null };

let cover: CopilotCover = { launcher: null, panel: null };
const listeners = new Set<() => void>();

function same(a: Box | null, b: Box | null): boolean {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}

function set(part: keyof CopilotCover, box: Box | null): void {
  if (same(cover[part], box)) return;
  cover = { ...cover, [part]: box };
  for (const listener of listeners) listener();
}

export const setCopilotPanel = (box: Box | null) => set("panel", box);
export const setCopilotLauncher = (box: Box | null) => set("launcher", box);

export function copilotPanel(): Box | null {
  return cover.panel;
}

export function copilotCover(): CopilotCover {
  return cover;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// What the copilot covers, for the browser pane to keep clear of.
export function useCopilotCover(): CopilotCover {
  return useSyncExternalStore(subscribe, copilotCover, () => cover);
}

// The launcher's box in a window of this size.
export function launcherBox(win: { width: number; height: number }): Box {
  const { size, inset, bottom } = LAUNCHER;
  return { x: win.width - inset - size, y: win.height - bottom - size, width: size, height: size };
}

// Where the native browser pane may draw, given its placeholder's box: nowhere while the peek or the
// chat overlaps it, and stopping short above the launcher when the launcher sits in its corner.
export function clearOfCopilot(box: Box, { launcher, panel }: CopilotCover): Box | null {
  if (overlaps(box, panel)) return null;
  if (!launcher || !overlaps(box, launcher)) return box;
  const height = launcher.y - 8 - box.y;
  return height > 0 ? { ...box, height } : null;
}
