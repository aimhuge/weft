// Where floating UI (hover bubbles, previews) may go. The browser pane is a native Electron view drawn
// over the web contents, so nothing in the page can sit above it: a bubble has to stay out of its way.

export type Box = { x: number; y: number; width: number; height: number };
export type Area = { left: number; top: number; right: number; bottom: number };
export type Size = { width: number; height: number };
export type Spot = { left: number; top: number };

const MARGIN = 8;

// The pane's last bounds as BrowserPane told the shell, or null while it's closed or hidden. Kept here
// so a hover reads it without a round trip to the shell.
let pane: Box | null = null;

export function setPaneBox(box: Box | null): void {
  pane = box && box.width > 0 && box.height > 0 ? box : null;
}

export function paneBox(): Box | null {
  return pane;
}

// The part of a window the page can draw over: all of it, less the pane on its right (or below).
export function visibleArea(win: Size, box: Box | null): Area {
  const area = { left: 0, top: 0, right: win.width, bottom: win.height };
  if (!box) return area;
  if (box.x > 0) area.right = Math.min(area.right, box.x);
  else if (box.y > 0) area.bottom = Math.min(area.bottom, box.y);
  return area;
}

// The visible area of this window right now.
export function currentArea(): Area {
  return visibleArea({ width: window.innerWidth, height: window.innerHeight }, pane);
}

// The widest a bubble may be and still fit the area, up to its own limit.
export function fitWidth(area: Area, max: number): number {
  return Math.max(0, Math.min(max, area.right - area.left - 2 * MARGIN));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// A bubble above its trigger (below if there's no room), starting at the trigger's left edge and
// flipping to end at its right edge when it would run past the area, then kept inside the area.
export function placeAbove(trigger: Area, bubble: Size, area: Area, gap = 6): Spot {
  const maxLeft = area.right - bubble.width - MARGIN;
  const left = trigger.left <= maxLeft ? trigger.left : trigger.right - bubble.width;
  const above = trigger.top - bubble.height - gap;
  const top = above >= area.top + MARGIN ? above : trigger.bottom + gap;
  return {
    left: clamp(left, area.left + MARGIN, maxLeft),
    top: clamp(top, area.top + MARGIN, area.bottom - bubble.height - MARGIN),
  };
}

// A preview to the right of its trigger, flipping to the left of it when there's no room.
export function placeBeside(trigger: Area, bubble: Size, area: Area, gap = 10, lift = 40): Spot {
  const maxLeft = area.right - bubble.width - MARGIN;
  const right = trigger.right + gap;
  const left = right <= maxLeft ? right : trigger.left - gap - bubble.width;
  return {
    left: clamp(left, area.left + MARGIN, maxLeft),
    top: clamp(trigger.top - lift, area.top + MARGIN, area.bottom - bubble.height - MARGIN),
  };
}

// A toolbar button's menu: under its trigger and ending at the trigger's right edge, slid back inside the area
// when that would run off it, and no taller than the room below.
export function placeMenuBelow(trigger: Area, width: number, area: Area, maxHeight: number, gap = 6): Spot & { maxHeight: number } {
  const top = trigger.bottom + gap;
  return {
    left: clamp(trigger.right - width, area.left + MARGIN, area.right - width - MARGIN),
    top,
    maxHeight: Math.max(0, Math.min(maxHeight, area.bottom - top - MARGIN)),
  };
}
