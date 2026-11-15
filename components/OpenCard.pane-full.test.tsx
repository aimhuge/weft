// @vitest-environment jsdom
// Simple mode's full-page pane in the open card (docs/architecture/simple-mode.md, piece 1): the show column folds into
// the pane's pill, opens inside the pane, and the pane gets the live line and reply box under its page. Off, nothing moves.
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setRailOpen, setThreadShown } from "@/lib/pane-rail-open";
import type { Card } from "@/lib/types";
import type { UseWorkspaceLayout } from "@/lib/use-workspace-layout";
import "./test-utils";

type Props = Record<string, unknown> & { columns?: Record<string, ReactNode> };
const seen = new Map<string, Props>();
vi.mock("./guarded", () => ({
  guarded: (_load: unknown, { what }: { what: string }) =>
    function Stub(props: Props) {
      seen.set(what, props);
      return <div data-what={what}>{props.columns && Object.entries(props.columns).map(([k, v]) => <div key={k} data-col={k}>{v}</div>)}</div>;
    },
}));
const piece = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/use-simple-piece", () => ({ useSimplePiece: () => piece.on }));

import OpenCard, { CardFrame, type OpenCardProps } from "./OpenCard";

afterEach(() => {
  // Reset the toggles first: the last test's tree is still mounted and re-renders into `seen`.
  act(() => setRailOpen(false));
  seen.clear();
  piece.on = true;
});

const card = { id: "c1", title: "Fix it", cwd: "/r", column: "running" } as Card;

function setup(pane = true) {
  const handlers = { onSend: vi.fn(), onAnswer: vi.fn(), onClose: vi.fn() } as unknown as OpenCardProps["handlers"];
  const workspace = {
    layout: { open: { thread: true, editor: false, pane, show: true } },
    fill: "pane",
    setOpen: vi.fn(),
    dragging: false,
  } as unknown as UseWorkspaceLayout;
  render(
    <OpenCard
      card={card}
      handlers={handlers}
      items={[]}
      streaming=""
      resets={[] as unknown as OpenCardProps["resets"]}
      editTitle={false}
      workspace={workspace}
      browser={{ desktop: true, state: { url: "http://x" } as OpenCardProps["browser"]["state"], width: 500, onWidth: vi.fn(), obscured: false }}
      onStar={vi.fn()}
      onTags={vi.fn()}
      onArchive={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  return handlers;
}

const pane = () => seen.get("browser pane")!;

describe("OpenCard's full-page pane", () => {
  it("hides the show and thread columns, gives the pane its pill and puts the reply strip under the whole card", () => {
    const handlers = setup();
    expect(seen.get("card workspace")!.hidden).toEqual(["show", "thread"]);
    expect(pane().pill).toBeTruthy();
    expect(pane().rail).toBeUndefined();
    expect(pane().bottom).toBeUndefined();
    expect(seen.get("pane reply box")).toMatchObject({ card, onSend: handlers.onSend, onAnswer: handlers.onAnswer });
  });

  it("brings the thread back once the live line opens it, with its own reply box and no strip under the page", () => {
    setup();
    seen.delete("pane reply box");
    act(() => setThreadShown(true));
    expect(seen.get("card workspace")!.hidden).toEqual(["show"]);
    expect(seen.has("pane reply box")).toBe(false);
    expect(pane().pill).toBeTruthy();
    act(() => setThreadShown(false));
  });

  it("puts the rail inside the pane once the pill opens it", () => {
    setup();
    act(() => setRailOpen(true));
    expect(pane().rail).toBeTruthy();
  });

  it("changes nothing when the piece is off", () => {
    piece.on = false;
    act(() => setRailOpen(true));
    setup();
    expect(seen.get("card workspace")!.hidden).toBeUndefined();
    expect(pane()).toMatchObject({ pill: undefined, rail: undefined });
    expect(seen.has("pane reply box")).toBe(false);
  });

  it("leaves the show column alone while the pane column is closed", () => {
    setup(false);
    expect(seen.get("card workspace")!.hidden).toBeUndefined();
  });

  it("sits inside the board beside simple mode's sidebar: no window, no backdrop", () => {
    const sidebar = document.createElement("nav");
    sidebar.setAttribute("data-board-sidebar", "");
    document.body.append(sidebar);
    const view = render(<CardFrame framed inBoard onBackdrop={vi.fn()} label="Fix it"><p>card</p></CardFrame>);
    expect(view.container.querySelector("[data-in-board]")).toBeInTheDocument();
    expect(view.container.querySelector("[data-backdrop]")).toBeNull();
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    view.rerender(<CardFrame framed onBackdrop={vi.fn()} label="Fix it"><p>card</p></CardFrame>);
    expect(view.container.querySelector('[role="dialog"]')).toBeInTheDocument();
    sidebar.remove();
  });
});
