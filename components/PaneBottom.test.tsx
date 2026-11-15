// @vitest-environment jsdom
// The full-page pane's bottom: the live line, the pending ask and the shared reply box, wired to the thread's handlers.
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GrantScope } from "@/lib/cloud-commands";
import { setThreadShown, threadShown } from "@/lib/pane-rail-open";
import { localTransport, ThreadTransportContext } from "@/lib/thread-transport";
import type { Card, ThreadItem } from "@/lib/types";
import { makeCard } from "./test-utils";

type Props = Record<string, unknown>;
const seen = new Map<string, Props>();
vi.mock("./guarded", () => ({
  guarded: (_load: unknown, { what }: { what: string }) =>
    function Stub(props: Props) {
      seen.set(what, props);
      return <div data-what={what} />;
    },
}));
const permission = vi.fn();
vi.mock("./ThreadFooter", () => ({
  PermissionRequest: (props: { answer: (allow: boolean, answers?: Record<string, string>, grant?: GrantScope) => void; answered: boolean }) => {
    permission(props);
    return null;
  },
}));
vi.mock("./ThreadView", () => ({ questionFor: vi.fn(() => ({ key: "q1" })) }));
// The full-page pane's piece (lib/simple-mode.ts): on, the reply box takes the phone look.
const piece = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/use-simple-piece", () => ({ useSimplePiece: () => piece.on }));

import PaneBottom from "./PaneBottom";

const items: ThreadItem[] = [
  { kind: "user", text: "Make the pricing page", at: 1 },
  { kind: "tool", id: "t", name: "Edit", summary: "app/pricing.tsx", at: 2 },
];

function setup(card: Card, transport = localTransport) {
  const onSend = vi.fn(() => Promise.resolve());
  const onAnswer = vi.fn(() => Promise.resolve());
  const stop = vi.fn(() => Promise.resolve());
  render(
    <ThreadTransportContext.Provider value={{ ...transport, stop }}>
      <PaneBottom card={card} items={items} onSend={onSend} onAnswer={onAnswer} />
    </ThreadTransportContext.Provider>,
  );
  return { onSend, onAnswer, stop, box: seen.get("reply box")! };
}

describe("PaneBottom", () => {
  it("toggles the thread from the live line, keeping the reply box while the thread is open", () => {
    seen.clear();
    const card = makeCard({ column: "review" });
    render(<PaneBottom card={card} items={[]} thread onSend={vi.fn()} onAnswer={vi.fn()} />);
    expect(seen.has("reply box")).toBe(true);
    expect(screen.getByText("Hide thread")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: /Open the thread/ }).click());
    expect(threadShown()).toBe(true);
    act(() => setThreadShown(false));
  });

  it("shows the newest step while the card runs, and hands the reply box the thread's own handlers", async () => {
    const card = makeCard({ column: "running", backend: "puku", sessionId: "s1" });
    const { onSend, stop, box } = setup(card);
    expect(screen.getByText("Edit · app/pricing.tsx")).toBeInTheDocument();
    expect(screen.getByLabelText("Waiting")).toBeInTheDocument();
    expect(box).toMatchObject({ cardId: "c1", live: true, midTurn: true, noPriorContext: false, question: { key: "q1" }, onSend, noShell: undefined });
    await (box.onStop as () => Promise<void>)();
    expect(stop).toHaveBeenCalledWith("c1");
  });

  it("answers a permission once", () => {
    const card = makeCard({ column: "needs_you", backend: "codex", pending: { id: "p1", toolName: "Bash", title: "Run it?", input: {} } });
    const { onAnswer, box } = setup(card);
    expect(box).toMatchObject({ midTurn: false, noPriorContext: true });
    const latest = () => permission.mock.lastCall![0] as { answer: (allow: boolean) => void };
    act(() => latest().answer(true));
    expect(onAnswer).toHaveBeenCalledWith(true, undefined, undefined, undefined);
    expect(latest()).toMatchObject({ answered: true });
    act(() => latest().answer(true));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("lets a refused answer be tried again", async () => {
    const card = makeCard({ column: "needs_you", pending: { id: "p2", toolName: "Bash", title: "Run it?", input: {} } });
    const onAnswer = vi.fn(() => Promise.reject(new Error("no")));
    render(<PaneBottom card={card} items={[]} onSend={vi.fn()} onAnswer={onAnswer} />);
    const { answer } = permission.mock.lastCall![0] as { answer: (allow: boolean) => void };
    act(() => answer(false));
    await vi.waitFor(() => expect(permission.mock.lastCall![0]).toMatchObject({ answered: false }));
    expect(screen.queryByLabelText("Waiting")).toBeNull();
  });

  it("does nothing with no prompt to answer, and says why a shell can't run off this Mac", () => {
    const { onAnswer } = setup(makeCard(), { ...localTransport, shell: undefined, shellRefusal: "No shell here." });
    (permission.mock.lastCall![0] as { answer: (allow: boolean) => void }).answer(true);
    expect(onAnswer).not.toHaveBeenCalled();
    expect(seen.get("reply box")).toMatchObject({ noShell: "No shell here.", onShell: undefined });
  });

  it("gives the reply box the phone look while simple mode's full-page pane is on, and none with it off", () => {
    setup(makeCard());
    expect(seen.get("reply box")?.look).toBeUndefined();
    piece.on = true;
    setup(makeCard());
    expect(seen.get("reply box")?.look).toBe("phone");
    piece.on = false;
  });

  it("runs a ! command through the transport's shell", async () => {
    const shell = vi.fn(() => Promise.resolve());
    setup(makeCard(), { ...localTransport, shell });
    await (seen.get("reply box")!.onShell as (c: string) => Promise<void>)("ls");
    expect(shell).toHaveBeenCalledWith("c1", "ls");
  });
});
