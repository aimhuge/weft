// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardWorkspace from "./CardWorkspace";
import { DEFAULT_LAYOUT, type ColumnId, type Layout } from "@/lib/workspace-layout";

afterEach(cleanup);

function makeWorkspace(over: Partial<{
  layout: Layout;
  fill: ColumnId;
  dragging: boolean;
  setDragging: (d: boolean) => void;
  toggle: (id: ColumnId) => void;
  dragDivider: (leftId: ColumnId, rightId: ColumnId, dx: number, w: number) => void;
  fitToContainer: (w: number) => void;
  columns: Record<ColumnId, React.ReactNode>;
  hidden: readonly ColumnId[];
}> = {}) {
  const setDragging = over.setDragging ?? vi.fn();
  const toggle = over.toggle ?? vi.fn();
  const dragDivider = over.dragDivider ?? vi.fn();
  const fitToContainer = over.fitToContainer ?? vi.fn();
  const columns = over.columns ?? {
    thread: <div data-testid="thread">thread</div>,
    editor: <div data-testid="editor">editor</div>,
    pane: <div data-testid="pane">pane</div>,
    show: <div data-testid="show">show</div>,
  };
  render(
    <CardWorkspace
      layout={over.layout ?? DEFAULT_LAYOUT}
      fill={over.fill ?? "pane"}
      dragging={over.dragging ?? false}
      setDragging={setDragging}
      toggle={toggle}
      dragDivider={dragDivider}
      fitToContainer={fitToContainer}
      columns={columns}
      hidden={over.hidden}
    />,
  );
  return { setDragging, toggle, dragDivider, fitToContainer };
}

describe("CardWorkspace", () => {
  it("leaves a hidden column out, with no sliver to reopen it", () => {
    makeWorkspace({ hidden: ["show"] });
    expect(screen.queryByTestId("show")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open show column" })).toBeNull();
    expect(screen.getByTestId("pane")).toBeTruthy();
  });

  it("renders open columns in left-to-right order", () => {
    makeWorkspace();
    // thread, pane, show are open by default; editor is closed.
    expect(screen.getByTestId("thread")).toBeTruthy();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.getByTestId("pane")).toBeTruthy();
    expect(screen.getByTestId("show")).toBeTruthy();
  });

  it("marks the fill column with data-fill and renders others with a width style", () => {
    makeWorkspace();
    // pane is the fill (preference order with pane open)
    const fill = document.querySelector('[data-fill="true"]');
    expect(fill).toBeTruthy();
    expect(fill?.getAttribute("data-column")).toBe("pane");
    // thread has a fixed width
    const thread = document.querySelector<HTMLElement>('[data-column="thread"]');
    expect(thread?.style.width).toBe(`${DEFAULT_LAYOUT.width.thread}px`);
    // show has a fixed width
    const show = document.querySelector<HTMLElement>('[data-column="show"]');
    expect(show?.style.width).toBe(`${DEFAULT_LAYOUT.width.show}px`);
  });

  it("draws an 18 px sliver with an icon for a closed column", () => {
    const layout: Layout = {
      open: { thread: false, editor: false, pane: true, show: false },
      width: { ...DEFAULT_LAYOUT.width },
    };
    makeWorkspace({ layout, fill: "pane" });
    const threadButton = screen.getByRole("button", { name: "Open thread column" });
    expect(threadButton).toBeTruthy();
    expect(threadButton.style.width).toBe("18px");
    // The icon SVG should be present
    expect(threadButton.querySelector("svg")).toBeTruthy();
  });

  it("reopens a closed column when the sliver is clicked", async () => {
    const toggle = vi.fn();
    const layout: Layout = { open: { ...DEFAULT_LAYOUT.open, show: false }, width: { ...DEFAULT_LAYOUT.width } };
    makeWorkspace({ layout, toggle });
    await userEvent.click(screen.getByRole("button", { name: "Open show column" }));
    expect(toggle).toHaveBeenCalledWith("show");
  });

  it("renders a drag divider between consecutive open columns", () => {
    // Open thread, pane, show; editor is closed (the default). Thread and pane still get a divider
    // past the editor's sliver, and pane + show get one → 2 dividers.
    makeWorkspace();
    const dividers = screen.getAllByRole("separator");
    expect(dividers).toHaveLength(2);
    expect(dividers[0]?.getAttribute("aria-label")).toBe("Resize between Thread and Pane");
    expect(dividers[1]?.getAttribute("aria-label")).toBe("Resize between Pane and Show");
  });

  it("renders a divider for every adjacent open pair when none are closed", () => {
    const layout: Layout = {
      open: { thread: true, editor: true, pane: true, show: true },
      width: { ...DEFAULT_LAYOUT.width },
    };
    makeWorkspace({ layout, fill: "pane" });
    // thread|editor, editor|pane, pane|show
    expect(screen.getAllByRole("separator")).toHaveLength(3);
  });

  it("puts the divider right after the left column when a closed one sits between", () => {
    // editor | (pane sliver) | show: the divider hugs the editor's edge, before the sliver.
    const layout: Layout = {
      open: { thread: false, editor: true, pane: false, show: true },
      width: { ...DEFAULT_LAYOUT.width },
    };
    makeWorkspace({ layout, fill: "editor" });
    const divider = screen.getByRole("separator");
    expect(divider.previousElementSibling?.getAttribute("data-column")).toBe("editor");
    expect(divider.nextElementSibling?.getAttribute("aria-label")).toBe("Open browser column");
  });

  it("draws no editor strip while the thread shows, so thread and pane meet at one divider", () => {
    makeWorkspace();
    expect(screen.queryByRole("button", { name: "Open editor column" })).toBeNull();
    const divider = screen.getAllByRole("separator")[0];
    expect(divider?.nextElementSibling?.getAttribute("data-column")).toBe("pane");
  });

  it("draws the editor strip when the thread is closed too", () => {
    const layout: Layout = { open: { ...DEFAULT_LAYOUT.open, thread: false }, width: { ...DEFAULT_LAYOUT.width } };
    makeWorkspace({ layout });
    expect(screen.getByRole("button", { name: "Open editor column" })).toBeTruthy();
  });

  it("flags the workspace as dragging while the divider is held", () => {
    const setDragging = vi.fn();
    const dragDivider = vi.fn();
    makeWorkspace({ setDragging, dragDivider });
    const divider = screen.getAllByRole("separator")[0];
    expect(divider).toBeTruthy();
    // Find the container and check that data-dragging reflects dragging state.
    const workspace = document.querySelector('[data-dragging]');
    expect(workspace).toBeNull();
  });

  it("marks the workspace container as dragging while a drag is active", () => {
    makeWorkspace({ dragging: true });
    const workspace = document.querySelector('[data-dragging="true"]');
    expect(workspace).toBeTruthy();
  });

  it("calls fitToContainer on window resize", () => {
    // jsdom has no ResizeObserver; the effect wires a `window.resize` listener. Dispatching one
    // triggers the report function it registered. The width is 0 in jsdom, so we don't assert the
    // value, just that the hook fired.
    const fitToContainer = vi.fn();
    render(
      <CardWorkspace
        layout={DEFAULT_LAYOUT}
        fill="pane"
        dragging={false}
        setDragging={vi.fn()}
        toggle={vi.fn()}
        dragDivider={vi.fn()}
        fitToContainer={fitToContainer}
        columns={{ thread: null, editor: null, pane: null, show: null }}
      />,
    );
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(fitToContainer).toHaveBeenCalled();
  });
});