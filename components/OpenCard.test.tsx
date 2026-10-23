// @vitest-environment jsdom
// The framed window (backdrop click, terminal offset, `contents` when nothing is open) and how the
// open card's workspace wires its four columns. guarded() is stubbed so each column renders a stub
// that records its props, keyed by the guard's `what`.

import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";
import type { UseWorkspaceLayout } from "@/lib/use-workspace-layout";

type Props = Record<string, unknown> & { columns?: Record<string, ReactNode> };
const seen = new Map<string, Props>();
vi.mock("./guarded", () => ({
  guarded: (_load: unknown, { what }: { what: string }) =>
    function Stub(props: Props) {
      seen.set(what, props);
      return <div data-what={what}>{props.columns && Object.entries(props.columns).map(([k, v]) => <div key={k} data-col={k}>{v}</div>)}</div>;
    },
}));

import OpenCard, { CardFrame, type OpenCardProps } from "./OpenCard";

afterEach(() => {
  cleanup();
  seen.clear();
});

const card = { id: "c1", title: "Fix it", cwd: "/r", column: "running" } as Card;

function workspace(): UseWorkspaceLayout {
  return {
    layout: { open: { thread: true, editor: false, pane: true, show: true } },
    fill: "pane",
    toggle: vi.fn(),
    setOpen: vi.fn(),
    dragDivider: vi.fn(),
    fitToContainer: vi.fn(),
    reset: vi.fn(),
    dragging: false,
    setDragging: vi.fn(),
  } as unknown as UseWorkspaceLayout;
}

function setup(over: Partial<OpenCardProps> = {}) {
  const props: OpenCardProps = {
    card,
    handlers: { onSend: vi.fn(), onClose: vi.fn() } as unknown as OpenCardProps["handlers"],
    items: [],
    streaming: "",
    resets: [] as unknown as OpenCardProps["resets"],
    editTitle: false,
    workspace: workspace(),
    browser: { desktop: true, state: { url: "http://x" } as OpenCardProps["browser"]["state"], width: 500, onWidth: vi.fn(), obscured: false },
    onStar: vi.fn(),
    onTags: vi.fn(),
    onShare: vi.fn(),
    onArchive: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  };
  render(<OpenCard {...props} />);
  return props;
}

describe("CardFrame", () => {
  it("renders a backdrop and a window while framed, and the backdrop closes", () => {
    const onBackdrop = vi.fn();
    const { container } = render(<CardFrame framed bottom={216} onBackdrop={onBackdrop}><p>inside</p></CardFrame>);
    const backdrop = container.children[0] as HTMLElement;
    const frame = container.children[1] as HTMLElement;
    fireEvent.click(backdrop);
    expect(onBackdrop).toHaveBeenCalledTimes(1);
    expect(frame.className).toContain("fixed inset-4");
    expect(frame.style.bottom).toBe("216px");
    expect(frame.textContent).toBe("inside");
  });

  it("is a bare `contents` wrapper when nothing is open", () => {
    const { container } = render(<CardFrame framed={false} onBackdrop={() => {}}>{null}</CardFrame>);
    expect(container.children).toHaveLength(1);
    expect((container.firstChild as HTMLElement).className).toBe("contents");
  });
});

describe("OpenCard", () => {
  it("hands the thread its card, handlers and marks", () => {
    const p = setup({ editTitle: true });
    const thread = seen.get("thread")!;
    expect(thread.card).toBe(card);
    expect(thread.onSend).toBe((p.handlers as unknown as Props).onSend);
    expect(thread.onStar).toBe(p.onStar);
    expect(thread.onArchive).toBe(p.onArchive);
    expect(thread.onOpenSettings).toBe(p.onOpenSettings);
    expect(thread.marksInPane).toBe(true);
    expect(thread.editorOpen).toBe(false);
    expect(thread.editTitle).toBe(true);
    (thread.onEditor as () => void)();
    expect(p.workspace.toggle).toHaveBeenCalledWith("editor");
  });

  it("closes the editor and pane columns, not the card", () => {
    const p = setup();
    (seen.get("editor column")!.onClose as () => void)();
    expect(p.workspace.setOpen).toHaveBeenCalledWith("editor", false);
    (seen.get("browser pane")!.onClose as () => void)();
    expect(p.workspace.setOpen).toHaveBeenCalledWith("pane", false);
  });

  it("obscures the pane while a divider drags, and gives the show rail the pane's page", () => {
    setup({ workspace: { ...workspace(), dragging: true } });
    expect(seen.get("browser pane")!.obscured).toBe(true);
    expect(seen.get("browser pane")!.expanded).toBe(true);
    expect(seen.get("show rail")!.pageUrl).toBe("http://x");
  });
});
