// @vitest-environment jsdom
// A worker's card opened in the board's own workspace (components/OpenCard.tsx): the thread reads through the worker's
// transport, the show rail beside it projects what that thread drew, and the pane is the worker's page. guarded() is
// stubbed so each column records its props, and the transport it was drawn in, keyed by the guard's `what`.
import { act, cleanup, render, screen } from "@testing-library/react";
import { useContext, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilesSourceContext } from "@/lib/files-source";
import { ThreadTransportContext } from "@/lib/thread-transport";
import { ToolResultSourceContext } from "@/lib/use-tool-result";
import { workerToolSource } from "@/lib/worker-transport";
import { lineFiles, lineTransport } from "@/lib/line-host";
import { useShownItems } from "@/lib/worker-shown";
import type { Card, ThreadItem } from "@/lib/types";
import type { UseWorkspaceLayout } from "@/lib/use-workspace-layout";

type Props = Record<string, unknown> & { columns?: Record<string, ReactNode> };
const seen = new Map<string, Props>();
vi.mock("./guarded", () => ({
  guarded: (_load: unknown, { what }: { what: string }) =>
    function Stub(props: Props) {
      seen.set(what, { ...props, transport: useContext(ThreadTransportContext), tools: useContext(ToolResultSourceContext), files: useContext(FilesSourceContext) });
      return <div data-what={what}>{props.columns && Object.entries(props.columns).map(([k, v]) => <div key={k} data-col={k}>{v}</div>)}</div>;
    },
}));

// How many of the card's changes wait for its worker (lib/worker-acts.ts).
const queued = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/worker-acts", async (load) => ({ ...(await load<typeof import("@/lib/worker-acts")>()), useWorkerQueued: () => queued.count }));

import OpenCard, { type OpenCardProps } from "./OpenCard";
import "./test-utils";

afterEach(() => {
  cleanup();
  seen.clear();
  queued.count = 0;
});

const card = { id: "w1", title: "Fix it", cwd: "worker://m1/ling", column: "review", page: "blob:sha256:aa" } as Card;
const item = (text: string): ThreadItem => ({ kind: "user", text, at: 0 });

function workspace(): UseWorkspaceLayout {
  return {
    layout: { open: { thread: true, editor: true, pane: true, show: true } },
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
    handlers: { onSend: vi.fn(), onAnswer: vi.fn(), onClose: vi.fn() },
    items: [],
    streaming: "",
    resets: [] as unknown as OpenCardProps["resets"],
    editTitle: false,
    workspace: workspace(),
    browser: { desktop: true, state: { url: "http://the-macs-own-pane" } as OpenCardProps["browser"]["state"], width: 500, onWidth: vi.fn(), obscured: false },
    onStar: vi.fn(),
    onTags: vi.fn(),
    onShare: vi.fn(),
    onArchive: vi.fn(),
    onOpenSettings: vi.fn(),
    worker: { name: "m1mini", status: "online" },
    ...over,
  };
  render(<OpenCard {...props} />);
  return props;
}

describe("a worker card in the board's own workspace", () => {
  it("draws its thread over its worker's transport (the session line, or the relay) and tool outputs", () => {
    const props = setup();
    const thread = seen.get("thread")!;
    expect(thread.transport).toBe(lineTransport("m1"));
    expect(thread.tools).toBe(workerToolSource);
    expect(thread.card).toBe(card);
    // The editor opens the worker's files (H4); Share… links the rows the worker published (lib/card-share-worker.ts).
    expect(typeof thread.onEditor).toBe("function");
    expect(thread.editorOpen).toBe(true);
    expect(thread.onShare).toBe(props.onShare);
  });

  it("opens with the show rail, which projects what the worker's thread drew, on the card's page", () => {
    setup();
    const drawn = [item("from m1mini")];
    act(() => {
      drawThread(drawn);
    });
    const rail = seen.get("show rail")!;
    expect(rail.card).toBe(card);
    expect(rail.items).toBe(drawn);
    expect(rail.pageUrl).toBe("blob:sha256:aa");
    expect(rail.shots).toEqual({});
    expect(typeof rail.onReopen).toBe("function");
  });

  it("puts the worker's pane on a page the rail reopens", () => {
    setup();
    const bb = `blob:sha256:${"b".repeat(64)}`;
    act(() => (seen.get("show rail")!.onReopen as (url: string) => void)(bb));
    expect(seen.get("worker pane")!.url).toBe(bb);
    expect(seen.get("show rail")!.pageUrl).toBe(bb);
  });

  it("shows the worker's page in its pane, not this Mac's native one", () => {
    const p = setup();
    expect(seen.has("browser pane")).toBe(false);
    const pane = seen.get("worker pane")!;
    expect(pane.card).toBe(card);
    expect(pane.worker).toEqual({ name: "m1mini", status: "online" });
    (pane.onClose as () => void)();
    expect(p.workspace.setOpen).toHaveBeenCalledWith("pane", false);
  });

  it("opens the worker's files in the editor, through its file verbs on its line", () => {
    const p = setup();
    const editor = seen.get("editor column")!;
    expect(editor.cardId).toBe("w1");
    // Over the worker's session line when it's up, the relay when it isn't (lib/line-host.ts).
    expect(editor.files).toBe(lineFiles("m1"));
    (editor.onClose as () => void)();
    expect(p.workspace.setOpen).toHaveBeenCalledWith("editor", false);
    (seen.get("thread")!.onEditor as () => void)();
    expect(p.workspace.toggle).toHaveBeenCalledWith("editor");
  });

  it("says so in the thread when the worker is offline", () => {
    setup({ worker: { name: "m1mini", status: "offline" } });
    render(<>{seen.get("thread")!.footer as ReactNode}</>);
    expect(screen.getByText(/m1mini is offline/)).toBeInTheDocument();
  });

  it("has no offline note while the worker is up", () => {
    setup();
    const { container } = render(<>{seen.get("thread")!.footer as ReactNode}</>);
    expect(container.textContent).toBe("");
  });
});


describe("the note under a worker card's thread", () => {
  const note = () => render(<>{seen.get("thread")!.footer as ReactNode}</>).container.textContent;

  it("counts the changes waiting for the worker, in the same line", () => {
    queued.count = 2;
    setup();
    expect(note()).toBe("2 changes wait for m1mini to take them, in order.");
  });

  it("says one waits, and that the worker is offline", () => {
    queued.count = 1;
    setup({ worker: { name: "m1mini", status: "offline" } });
    expect(note()).toBe("m1mini is offline. 1 change waits for m1mini to take it.");
  });

  it("names no worker it doesn't know", () => {
    queued.count = 1;
    setup({ worker: undefined });
    expect(note()).toBe("1 change waits for Your worker to take it.");
  });

  it("isn't there for a card on this Mac", () => {
    queued.count = 3;
    setup({ card: { ...card, cwd: "/r" }, worker: undefined });
    expect(note()).toBe("");
  });
});

// The worker's thread view handing the rail what it drew (lib/worker-shown.ts), as ThreadView does through useView.
function drawThread(items: ThreadItem[]) {
  function View() {
    useShownItems(items);
    return null;
  }
  render(<View />);
}
