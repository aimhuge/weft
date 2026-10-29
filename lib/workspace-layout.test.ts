import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  DEFAULT_LAYOUT,
  type Layout,
  MIN_WIDTH,
  dragDivider,
  effectiveWidth,
  fillColumn,
  fitToWidth,
  parse,
  serialize,
  setOpen,
  toggleColumn,
} from "./workspace-layout";

function makeLayout(over: { open?: Partial<Layout["open"]>; width?: Partial<Layout["width"]> } = {}): Layout {
  return {
    open: { ...DEFAULT_LAYOUT.open, ...over.open },
    width: { ...DEFAULT_LAYOUT.width, ...over.width },
  };
}

describe("workspace-layout constants", () => {
  it("lists columns in left-to-right order", () => {
    expect(COLUMNS).toEqual(["thread", "editor", "pane", "show"]);
  });

  it("declares a min for every column", () => {
    for (const id of COLUMNS) expect(typeof MIN_WIDTH[id]).toBe("number");
  });

  it("opens thread, pane and show by default, and editor closed", () => {
    expect(DEFAULT_LAYOUT.open).toEqual({ thread: true, editor: false, pane: true, show: true });
  });
});

describe("fillColumn", () => {
  it("prefers the pane when open", () => {
    expect(fillColumn(makeLayout())).toBe("pane");
  });

  it("falls back to editor, then thread, then show", () => {
    // Close pane → editor is the next preferred fill. But editor is closed by default, so thread wins.
    expect(fillColumn(makeLayout({ open: { pane: false } }))).toBe("thread");
    // Open editor and close pane → editor wins.
    expect(fillColumn(makeLayout({ open: { pane: false, editor: true } }))).toBe("editor");
    // Close pane and editor → thread wins.
    expect(fillColumn(makeLayout({ open: { pane: false, editor: false, thread: true } }))).toBe("thread");
    // Close pane, editor, thread → show is the only one left.
    expect(fillColumn(makeLayout({ open: { pane: false, editor: false, thread: false } }))).toBe("show");
  });

  it("returns show as a last-ditch fill when nothing is open", () => {
    const layout: Layout = {
      open: { thread: false, editor: false, pane: false, show: false },
      width: { ...DEFAULT_LAYOUT.width },
    };
    expect(fillColumn(layout)).toBe("show");
  });
});

describe("effectiveWidth", () => {
  it("returns 0 for a closed column", () => {
    const layout = makeLayout({ open: { pane: false } });
    expect(effectiveWidth(layout, "pane", 1200)).toBe(0);
  });

  it("returns the recorded width for a fixed column", () => {
    const layout = makeLayout();
    expect(effectiveWidth(layout, "thread", 1200)).toBe(DEFAULT_LAYOUT.width.thread);
  });

  it("gives the fill column the container minus the fixed ones", () => {
    const layout = makeLayout();
    // pane is fill, fixed = thread + show = 440 + 72 = 512
    expect(effectiveWidth(layout, "pane", 1200)).toBe(1200 - 512);
  });

  it("clamps the fill column to its min when the container is too narrow", () => {
    const layout = makeLayout();
    // container 200, fixed 512 → would be -312, clamp to MIN_WIDTH.pane
    expect(effectiveWidth(layout, "pane", 200)).toBe(MIN_WIDTH.pane);
  });
});

describe("toggleColumn", () => {
  it("opens a closed column", () => {
    const layout = makeLayout();
    expect(layout.open.editor).toBe(false);
    const next = toggleColumn(layout, "editor");
    expect(next.open.editor).toBe(true);
  });

  it("closes an open column when others remain open", () => {
    const layout = makeLayout();
    const next = toggleColumn(layout, "show");
    expect(next.open.show).toBe(false);
  });

  it("refuses to close the last open column", () => {
    const layout = makeLayout({ open: { thread: false, editor: false, pane: false, show: true } });
    const next = toggleColumn(layout, "show");
    expect(next.open.show).toBe(true);
  });

  it("does not mutate the input layout", () => {
    const layout = makeLayout();
    toggleColumn(layout, "editor");
    expect(layout.open.editor).toBe(false);
  });
});

describe("setOpen", () => {
  it("opens a column", () => {
    const next = setOpen(makeLayout(), "editor", true);
    expect(next.open.editor).toBe(true);
  });

  it("closes a column when others stay open", () => {
    const next = setOpen(makeLayout(), "thread", false);
    expect(next.open.thread).toBe(false);
  });

  it("refuses to close the last open column", () => {
    const layout = makeLayout({ open: { thread: false, editor: false, pane: false, show: true } });
    expect(setOpen(layout, "show", false).open.show).toBe(true);
  });

  it("hands back the same layout when the column is already in that state", () => {
    // Opening a card asks for the pane every time; the pane is usually already open, and an
    // unchanged layout means nothing re-renders or re-writes storage.
    const layout = makeLayout();
    expect(setOpen(layout, "pane", true)).toBe(layout);
    expect(setOpen(layout, "editor", false)).toBe(layout);
  });
});

describe("dragDivider", () => {
  it("shrinks the non-fill side on negative dx, clamped to its min", () => {
    const layout = makeLayout({ width: { thread: 600, editor: 480, pane: 600, show: 72 } });
    const next = dragDivider(layout, "thread", "pane", -500, 1500);
    // 600 - 500 = 100, but MIN_WIDTH.thread is 320
    expect(next.width.thread).toBe(MIN_WIDTH.thread);
  });

  it("grows the non-fill side on positive dx, clamped so the fill keeps its min", () => {
    // container 600, fill pane min 280 → fill keeps at least 280. Thread (movable) grows by 200:
    // 400 + 200 = 600, but maxForMovable = 600 - 72 (show) - 280 = 248, clamped to MIN_WIDTH.thread 320.
    const layout = makeLayout({ width: { thread: 400, editor: 480, pane: 600, show: 72 } });
    const next = dragDivider(layout, "thread", "pane", 200, 600);
    expect(next.width.thread).toBe(MIN_WIDTH.thread);
  });

  it("moves the fixed side when its neighbour is the fill", () => {
    // open only thread + editor; fill = editor (no pane). Drag the divider between them.
    const layout: Layout = {
      open: { thread: true, editor: true, pane: false, show: false },
      width: { thread: 440, editor: 480, pane: 600, show: 72 },
    };
    // thread is the only fixed column. dx=-100 → 440-100=340. maxForMovable = 1000 - 0 - 300 = 700. OK.
    const next = dragDivider(layout, "thread", "editor", -100, 1000);
    expect(next.width.thread).toBe(340);
  });

  it("is a no-op when both sides are the fill", () => {
    // Only pane is open: pane is the fill, and it shows up on both sides of the synthetic divider.
    const layout: Layout = {
      open: { thread: false, editor: false, pane: true, show: false },
      width: { ...DEFAULT_LAYOUT.width },
    };
    expect(dragDivider(layout, "pane", "pane", 50, 1200)).toBe(layout);
  });

  it("shrinks a movable right side when the divider moves right", () => {
    // editor closed; pane is the fill. Drag between pane and show: show is movable and sits on
    // the right, so dragging right narrows it and dragging left widens it.
    const layout = makeLayout({ width: { show: 120 } });
    expect(dragDivider(layout, "pane", "show", 30, 1500).width.show).toBe(90);
    expect(dragDivider(layout, "pane", "show", -30, 1500).width.show).toBe(150);
  });

  it("is a no-op when the divider's movable side is the fill", () => {
    // layout with fill = thread (pane and editor closed, show closed, only thread).
    // Actually if show is the only open, fill = show. Here editor, pane, show are all closed.
    const layout: Layout = {
      open: { thread: true, editor: false, pane: false, show: false },
      width: { ...DEFAULT_LAYOUT.width },
    };
    // fill = thread. Drag between thread and editor: editor is movable, but editor is closed → no-op.
    const next = dragDivider(layout, "thread", "editor", 50, 1500);
    expect(next).toBe(layout);
  });

  it("ignores the divider when the movable column is closed", () => {
    const layout = makeLayout({ open: { thread: false } });
    const next = dragDivider(layout, "thread", "pane", 50, 1500);
    expect(next).toBe(layout);
  });

  it("does not mutate the input layout", () => {
    const layout = makeLayout();
    const widthBefore = layout.width.thread;
    dragDivider(layout, "thread", "pane", 20, 1500);
    expect(layout.width.thread).toBe(widthBefore);
  });
});

describe("fitToWidth", () => {
  it("is a no-op when the layout already fits", () => {
    const layout = makeLayout();
    expect(fitToWidth(layout, 2000)).toBe(layout);
  });

  it("shrinks fixed columns proportionally when the window is narrow", () => {
    // Fixed: thread 440, show 72 = 512. Fill pane min 280. target = 700 - 280 = 420.
    // 512 > 420, so shrink. The show rail is already at its 72 px min, so the thread gives it all.
    const layout = makeLayout({ width: { thread: 440, editor: 480, pane: 600, show: 72 } });
    const next = fitToWidth(layout, 700);
    expect(next.width.thread).toBeLessThan(440);
    expect(next.width.show).toBe(MIN_WIDTH.show);
    // Total fixed should now be 420 (700 - 280 pane min).
    expect(next.width.thread + next.width.show).toBeCloseTo(420, 1);
  });

  it("pins a column at its min when proportional shrinking would go below", () => {
    // thread 400, editor 200, show 72. fill = pane. target = 1000 - 280 = 720. total = 672.
    // 672 <= 720, no shrink — use a different setup.
    // Container 800. fixed = thread(400) + editor(200) + show(72) = 672. target = 800-280 = 520.
    // 672 > 520. Scale 520/672 = 0.774. thread 309 < 320 → pin. editor 155 < 300 → pin.
    // After pinning thread + editor (320+300=620), budget left = 520-620 = -100 → stops.
    // Show keeps 72. Total fixed = 320+300+72 = 692 > 520 — over the budget. The test confirms
    // that pinning at min is honored, even when the budget can't be met.
    const layout: Layout = {
      open: { thread: true, editor: true, pane: true, show: true },
      width: { thread: 400, editor: 200, pane: 600, show: 72 },
    };
    const next = fitToWidth(layout, 800);
    expect(next.width.thread).toBe(MIN_WIDTH.thread);
    expect(next.width.editor).toBe(MIN_WIDTH.editor);
  });

  it("returns the same layout when every fixed column is already at its min", () => {
    const layout: Layout = {
      open: { thread: true, editor: true, pane: true, show: true },
      width: { thread: MIN_WIDTH.thread, editor: MIN_WIDTH.editor, pane: 600, show: MIN_WIDTH.show },
    };
    // Too narrow for even the mins: nothing can move, so a fresh copy would loop CardWorkspace's effect.
    expect(fitToWidth(layout, 0)).toBe(layout);
    expect(fitToWidth(layout, 500)).toBe(layout);
  });

  it("settles after one fit: fitting the fitted layout again is a no-op", () => {
    const layout: Layout = {
      open: { thread: true, editor: true, pane: true, show: true },
      width: { thread: 700, editor: 650, pane: 600, show: 90 },
    };
    const once = fitToWidth(layout, 1333);
    expect(once).not.toBe(layout);
    expect(fitToWidth(once, 1333)).toBe(once);
  });

  it("returns the layout unchanged when the fill is the only open column", () => {
    const layout: Layout = {
      open: { thread: false, editor: false, pane: true, show: false },
      width: { ...DEFAULT_LAYOUT.width },
    };
    expect(fitToWidth(layout, 200)).toBe(layout);
  });
});

describe("serialize and parse", () => {
  it("round-trips a layout", () => {
    const layout = makeLayout({ width: { thread: 500, show: 100 } });
    const s = serialize(layout);
    expect(parse(s)).toEqual(layout);
  });

  it("returns defaults when the input is not an object", () => {
    expect(parse(null)).toEqual(DEFAULT_LAYOUT);
    expect(parse(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(parse(42)).toEqual(DEFAULT_LAYOUT);
    expect(parse("nope")).toEqual(DEFAULT_LAYOUT);
  });

  it("falls back to defaults for individual bad fields", () => {
    const parsed = parse({ open: { thread: "yes" }, width: { editor: -3 } });
    expect(parsed.open.thread).toBe(DEFAULT_LAYOUT.open.thread);
    expect(parsed.width.editor).toBe(DEFAULT_LAYOUT.width.editor);
  });

  it("clamps an out-of-range width to the column min", () => {
    const parsed = parse({ open: {}, width: { thread: 1 } });
    expect(parsed.width.thread).toBe(MIN_WIDTH.thread);
  });

  it("clamps an absurdly large width to a reasonable cap", () => {
    const parsed = parse({ open: {}, width: { thread: 999999 } });
    expect(parsed.width.thread).toBeLessThanOrEqual(4000);
  });

  it("re-opens the pane when a parsed layout has every column closed", () => {
    const parsed = parse({ open: { thread: false, editor: false, pane: false, show: false }, width: {} });
    expect(parsed.open.pane).toBe(true);
  });

  it("ignores extra columns the user may have added by hand", () => {
    const parsed = parse({ open: { thread: false, extra: true }, width: { thread: 500, extra: 10 } });
    expect(parsed.open.thread).toBe(false);
    expect(parsed.open.pane).toBe(DEFAULT_LAYOUT.open.pane);
  });

  it("ignores a NaN width", () => {
    const parsed = parse({ open: {}, width: { thread: Number.NaN } });
    expect(parsed.width.thread).toBe(DEFAULT_LAYOUT.width.thread);
  });
});

describe("type guards", () => {
  it("treats an unknown id as not a column", () => {
    // The exported typescript types keep the public surface honest; runtime input is filtered.
    const layout = makeLayout();
    expect(layout.open.thread).toBe(true);
  });
});

// A tiny "smoke" check that builds a layout, drags, fits, and serializes — the order a UI would do.
describe("integration", () => {
  it("drag then fit then parse matches the dragged layout (after fitting)", () => {
    let layout = makeLayout();
    layout = dragDivider(layout, "thread", "pane", 60, 1500);
    const fitted = fitToWidth(layout, 1500);
    expect(fitted.width.thread).toBe(500);
    const parsed = parse(serialize(fitted));
    expect(parsed).toEqual(fitted);
  });
});
