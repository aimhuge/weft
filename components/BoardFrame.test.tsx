// @vitest-environment jsdom
// The board's framed window (components/BoardFrame.tsx): one open card, wherever it runs. This Mac's opens with the
// board's thread and handlers; a worker's with its own handlers, its worker and an empty start, since its thread view
// pages itself in through its host.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "@/lib/types";
import type { BoardFrameProps } from "./BoardFrame";

const opened = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("./OpenCard", () => ({
  default: (props: Record<string, unknown>) => {
    opened.props = props;
    return null;
  },
  CardFrame: ({ children }: { children: unknown }) => children,
}));
vi.mock("./guarded", () => ({ guarded: () => () => null }));

const { default: BoardFrame } = await import("./BoardFrame");

afterEach(() => {
  cleanup();
  opened.props = null;
});

const mine = { id: "m1", title: "Mine", cwd: "/r" } as Card;
const theirs = { id: "w1", title: "Theirs", cwd: "worker://m1/ling" } as Card;
const items: ThreadItem[] = [{ kind: "user", text: "hi", at: 0 }];

function frame(over: Partial<BoardFrameProps>) {
  const props = {
    showNew: false, framed: true, selected: null, workerThread: null, cards: [], home: "/", project: null, restart: null, onCreate: vi.fn(), onCloseNew: vi.fn(),
    items, handlers: null, streaming: "…", renameId: null, workspace: {} as never, desktop: true, browser: {} as never, obscured: false,
    browserWidth: 500, onBrowserWidth: vi.fn(), onStar: vi.fn(), onTags: vi.fn(), onShare: vi.fn(), onArchive: vi.fn(), onOpenSettings: vi.fn(),
    bottom: undefined, onBackdrop: vi.fn(), ...over,
  } as BoardFrameProps;
  render(<BoardFrame {...props} />);
  return props;
}

describe("BoardFrame", () => {
  it("opens this Mac's card with the board's thread and handlers", () => {
    const handlers = { onSend: vi.fn() } as unknown as BoardFrameProps["handlers"];
    frame({ selected: mine, handlers, renameId: "m1" });
    expect(opened.props).toMatchObject({ card: mine, handlers, items, streaming: "…", worker: undefined, editTitle: true });
  });

  it("opens a worker's card in the same workspace, with its own handlers and worker", () => {
    const handlers = { onSend: vi.fn(), onAnswer: vi.fn(), onClose: vi.fn() };
    const worker = { name: "m1mini", status: "online" as const };
    frame({ workerThread: { card: theirs, worker, handlers } as never });
    expect(opened.props).toMatchObject({ card: theirs, handlers, worker, items: [], streaming: "", editTitle: false });
  });

  it("opens nothing with no card", () => {
    frame({});
    expect(opened.props).toBeNull();
  });
});
