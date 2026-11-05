// Where a dropdown's list goes: under its field when there's room, over it when there isn't, and
// always inside the area the page can draw over (lib/float-place.ts's area, which stops at the
// browser pane's edge).
//
// The rule is one function, placeDropdown, so the New thread dialog's model picker and every
// Settings → Models picker place their list the same way: the list never runs off the bottom of
// the window, never runs under the browser pane, and never hides the field it belongs to.

import { type Area, type Spot } from "./float-place";

export type DropdownPlacement = {
  // Where the list's top-left corner goes, in window coordinates.
  spot: Spot;
  // Which side of the field the list opens on.
  side: "below" | "above";
  // The most the list may be tall: the room in the direction it opens.
  maxHeight: number;
  // The list's width: the field's, but never wider than the area allows.
  width: number;
};

// The gap between the field and the list, in pixels.
const GAP = 4;
// The room the list keeps from the area's edges.
const MARGIN = 8;
// The widest a model list may be, so it doesn't stretch across a wide window.
const MAX_WIDTH = 300;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Where a dropdown's list goes.
 *
 * The list opens below the field when the room below can hold a useful share of it, and above
 * otherwise — so a field near the bottom of the window (the New thread dialog's model picker sits
 * in a row of controls low in the dialog) flips up instead of hanging off the screen. Whichever
 * side it opens on, the height is capped to the room on that side, so the list scrolls rather
 * than overflows.
 *
 * The width is the field's own, so the list lines up with the box the user clicked, but never
 * wider than the area allows.
 */
export function placeDropdown(
  field: { left: number; top: number; right: number; bottom: number; width: number },
  area: Area,
  wanted: { width: number; height: number },
): DropdownPlacement {
  // The list is as wide as the field, but at least wide enough to read a model name and never
  // wider than the area it has to sit in.
  const width = clamp(wanted.width, 0, Math.max(0, Math.min(MAX_WIDTH, area.right - area.left - 2 * MARGIN)));
  const roomBelow = area.bottom - field.bottom - GAP - MARGIN;
  const roomAbove = field.top - area.top - GAP - MARGIN;

  // Below when there's room for most of the list; above when there isn't. A field with no room
  // either way still opens below — the list then scrolls in the little room it has.
  const side: "below" | "above" = roomBelow >= Math.min(wanted.height, roomAbove) ? "below" : "above";
  const room = side === "below" ? roomBelow : roomAbove;
  const maxHeight = Math.max(0, Math.min(wanted.height, room));

  const left = clamp(field.left, area.left + MARGIN, Math.max(area.left + MARGIN, area.right - width - MARGIN));
  const top = side === "below" ? field.bottom + GAP : field.top - GAP - maxHeight;

  return {
    spot: {
      left,
      top: clamp(top, area.top + MARGIN, Math.max(area.top + MARGIN, area.bottom - maxHeight - MARGIN)),
    },
    side,
    maxHeight,
    width,
  };
}
