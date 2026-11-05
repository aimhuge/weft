// The four-column workspace for an open card: thread | editor | pane | show, in that left-to-right
// order. A layout remembers which columns are open and how wide each is. One column at a time is
// "the fill" — the one with no fixed width, which takes whatever space is left after the others and
// (when the window narrows) keeps its own min by shrinking the fixed columns instead.

// Order matters: it is the order the columns render in, left to right.
export const COLUMNS = ["thread", "editor", "pane", "show"] as const;
export type ColumnId = (typeof COLUMNS)[number];

// The fill column preference, highest first: pane (the agent's main canvas) wins, then editor, then
// thread, then show. The fill is the open column that takes leftover space when the window is
// wider than the sum of the others.
export const FILL_PREFERENCE: readonly ColumnId[] = ["pane", "editor", "thread", "show"];

export interface Layout {
  open: Record<ColumnId, boolean>;
  width: Record<ColumnId, number>;
}

export const MIN_WIDTH: Record<ColumnId, number> = {
  thread: 320,
  editor: 300,
  pane: 280,
  show: 72,
};

// Open by default for thread, pane and show; editor closed. Widths picked to feel like the old
// single-window layout (a ~440 px thread, a ~480 px editor when the user opens it, a pane that
// claims the rest, and a 72 px show rail).
export const DEFAULT_LAYOUT: Layout = {
  open: { thread: true, editor: false, pane: true, show: true },
  width: { thread: 440, editor: 480, pane: 600, show: 72 },
};

// The column that takes the leftover space. Preference order: pane, editor, thread, show — so the
// pane (the agent's main canvas) is normally the flex one and small columns stay fixed. When the
// preferred column is closed, the next open one becomes the fill.
export function fillColumn(layout: Layout): ColumnId {
  for (const id of FILL_PREFERENCE) {
    if (layout.open[id]) return id;
  }
  // No column open: clamp the toggleColumn guarantee; treat show as the implicit fill so widths
  // can still resolve. The UI shouldn't let this happen.
  return "show";
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// Sum of fixed (non-fill) columns at their current widths. The fill column's width is unused here
// because flex-1 takes whatever is left of the container.
function fixedTotal(layout: Layout, fill: ColumnId): number {
  let total = 0;
  for (const id of COLUMNS) {
    if (id === fill) continue;
    if (!layout.open[id]) continue;
    total += layout.width[id];
  }
  return total;
}

// A column's effective rendered width when the container is `containerWidth` and the fill column is
// `fill`. Fixed columns keep their recorded width; the fill takes the rest (down to its min, with the
// other fixed columns shrunken proportionally so the layout still fits — see fitToWidth).
export function effectiveWidth(layout: Layout, id: ColumnId, containerWidth: number): number {
  if (!layout.open[id]) return 0;
  if (id === fillColumn(layout)) {
    const fixed = fixedTotal(layout, id);
    return Math.max(MIN_WIDTH[id], containerWidth - fixed);
  }
  return layout.width[id];
}

// Toggles `id`. The fill column is protected: closing the last open column reopens it instead, so a
// layout always has at least one open column.
export function toggleColumn(layout: Layout, id: ColumnId): Layout {
  const next = cloneLayout(layout);
  const openCount = COLUMNS.reduce((n, c) => (next.open[c] ? n + 1 : n), 0);
  if (next.open[id] && openCount <= 1) return next;
  next.open[id] = !next.open[id];
  return next;
}

export function setOpen(layout: Layout, id: ColumnId, open: boolean): Layout {
  // Already in that state: hand back the same layout, so nothing re-renders or re-writes storage.
  // Opening a card asks for the pane every time, and the pane is usually already open.
  if (layout.open[id] === open) return layout;
  const next = cloneLayout(layout);
  const openCount = COLUMNS.reduce((n, c) => (next.open[c] ? n + 1 : n), 0);
  if (!open && openCount <= 1) return next;
  next.open[id] = open;
  return next;
}

function cloneLayout(layout: Layout): Layout {
  return {
    open: { ...layout.open },
    width: { ...layout.width },
  };
}

// Drags the divider between `leftId` and `rightId` by `dx` pixels (positive = right). Only one of the
// two can be the fill column, and only the non-fill side actually changes width (it grows when the
// divider moves away from it): the fill's width is
// the container minus the sum of the others, so its width follows automatically. The new width is
// clamped to its column's min and so the fill column still has at least its own min left.
export function dragDivider(
  layout: Layout,
  leftId: ColumnId,
  rightId: ColumnId,
  dx: number,
  containerWidth: number,
): Layout {
  const fill = fillColumn(layout);
  if (leftId === fill && rightId === fill) return layout;
  const movable = leftId === fill ? rightId : leftId;
  if (movable === fill) return layout;
  if (!layout.open[movable]) return layout;

  const next = cloneLayout(layout);
  const otherFixed: number[] = [];
  for (const id of COLUMNS) {
    if (id === fill || id === movable) continue;
    if (!next.open[id]) continue;
    otherFixed.push(next.width[id]);
  }
  const reservedForOthers = otherFixed.reduce((a, b) => a + b, 0);
  const maxForMovable = Math.max(MIN_WIDTH[movable], containerWidth - reservedForOthers - MIN_WIDTH[fill]);
  // Dragging right grows a column on the divider's left and shrinks one on its right.
  const delta = movable === leftId ? dx : -dx;
  next.width[movable] = clamp(next.width[movable] + delta, MIN_WIDTH[movable], maxForMovable);
  return next;
}

// The window is `containerWidth`. Shrink the fixed columns proportionally (not below their min)
// until the layout fits and the fill column has at least its min. Returns a layout unchanged if
// everything already fits, so a wider window is a no-op.
export function fitToWidth(layout: Layout, containerWidth: number): Layout {
  const fill = fillColumn(layout);
  const fixedIds: ColumnId[] = [];
  for (const id of COLUMNS) {
    if (id === fill) continue;
    if (!layout.open[id]) continue;
    fixedIds.push(id);
  }
  if (fixedIds.length === 0) return layout;
  const total = fixedIds.reduce((sum, id) => sum + layout.width[id], 0);
  const target = Math.max(0, containerWidth - MIN_WIDTH[fill]);
  // Half a pixel of slack: float rounding after a proportional shrink must not count as "doesn't fit".
  if (total <= target + 0.5) return layout;

  // Shrink proportionally, but never below each column's min. The first to hit min is pinned and
  // removed from the pool, then the rest share the remaining shortfall. Loop until everything fits
  // or all columns are pinned.
  const next = cloneLayout(layout);
  const pinned = new Set<ColumnId>();
  let budget = target;
  while (pinned.size < fixedIds.length) {
    const active = fixedIds.filter((id) => !pinned.has(id));
    const activeTotal = active.reduce((s, id) => s + next.width[id], 0);
    if (activeTotal <= budget) break;
    const scale = budget / activeTotal;
    let hitMin = false;
    for (const id of active) {
      const min = MIN_WIDTH[id];
      const wanted = next.width[id] * scale;
      if (wanted <= min) {
        next.width[id] = min;
        pinned.add(id);
        budget -= min;
        hitMin = true;
      } else {
        next.width[id] = wanted;
      }
    }
    if (!hitMin) break;
  }
  // If pinning all columns still leaves a shortfall, the fill column would shrink below its min —
  // there's nothing more to do, leave the layout as-is. Return the same object when no width moved
  // (every column already at its min): a fresh copy would re-render CardWorkspace, whose effect
  // fits again, forever ("Maximum update depth exceeded").
  return fixedIds.some((id) => next.width[id] !== layout.width[id]) ? next : layout;
}

// A serializable form: a plain object with the four open/width fields. Used by the hook (and any
// other consumer) to write to localStorage and read it back without a runtime dependency on the
// Layout shape. Returns a fresh default for any field that doesn't look right.
export interface SerializedLayout {
  open: Partial<Record<ColumnId, boolean>>;
  width: Partial<Record<ColumnId, number>>;
}

export function serialize(layout: Layout): SerializedLayout {
  return {
    open: { ...layout.open },
    width: { ...layout.width },
  };
}

export function parse(value: unknown): Layout {
  const result: Layout = cloneLayout(DEFAULT_LAYOUT);
  if (!value || typeof value !== "object") return result;
  const data = value as Record<string, unknown>;
  const openRecord = data["open"];
  const widthRecord = data["width"];
  if (openRecord && typeof openRecord === "object") {
    for (const id of COLUMNS) {
      const v = (openRecord as Record<string, unknown>)[id];
      if (typeof v === "boolean") result.open[id] = v;
    }
  }
  if (widthRecord && typeof widthRecord === "object") {
    for (const id of COLUMNS) {
      const v = (widthRecord as Record<string, unknown>)[id];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        result.width[id] = clamp(v, MIN_WIDTH[id], 4000);
      }
    }
  }
  // A parsed layout that has every column closed violates the invariant; re-open the default fill.
  const anyOpen = COLUMNS.some((id) => result.open[id]);
  if (!anyOpen) result.open.pane = true;
  return result;
}
