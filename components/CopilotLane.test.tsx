// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copilotPanel } from "@/lib/copilot-float";
import type { ThreadItem } from "@/lib/types";
import CopilotLane from "./CopilotLane";
import { makeCard } from "./test-utils";

const thread = vi.hoisted(() => ({
  card: null as ReturnType<typeof makeCard> | null,
  items: [] as ThreadItem[],
  send: vi.fn(async () => {}),
  newChat: vi.fn(async () => {}),
  resetting: false,
}));

vi.mock("@/lib/use-copilot-thread", () => ({
  useCopilotThread: () => ({ ...thread, streaming: "", error: null, fail: vi.fn() }),
}));
vi.mock("./ThreadView", () => ({
  default: ({ items }: { items: ThreadItem[] }) => <div data-testid="thread">{items.length} items</div>,
}));

beforeEach(() => {
  thread.card = makeCard({ id: "copilot", role: "copilot", column: "review", warm: true });
  thread.items = [
    { kind: "user", text: "status?", at: 10 },
    { kind: "assistant", text: "All quiet on the board.", at: 11 },
  ];
  thread.send.mockClear();
  thread.resetting = false;
});

function lane(state: "hidden" | "peek" | "open", over: Partial<Parameters<typeof CopilotLane>[0]> = {}) {
  const props = {
    state,
    cards: [] as Parameters<typeof CopilotLane>[0]["cards"],
    onOpenCard: vi.fn(),
    onHide: vi.fn(),
    onPeek: vi.fn(),
    onOpen: vi.fn(),
    toggleTip: "Copilot (⌘J)",
    ...over,
  };
  const view = render(<CopilotLane {...props} />);
  return Object.assign(props, { unmount: view.unmount });
}

describe("CopilotLane hidden", () => {
  it("is only the round launcher, pinned to the bottom-right corner above every dialog", () => {
    lane("hidden");
    const launcher = screen.getByLabelText(/Open the copilot/);
    expect(launcher).toHaveStyle({ right: "16px", bottom: "44px", width: "52px", height: "52px" });
    expect(launcher.className).toContain("fixed");
    expect(launcher.className).toContain("z-[96]");
    expect(launcher).toHaveAttribute("data-drop-target", "copilot");
    expect(document.querySelector("aside")).toBeNull();
    expect(copilotPanel()).toBeNull();
  });

  it("shows a needs-you dot and the count when there's news", () => {
    const waiting = makeCard({ id: "w", title: "Pick a domain", column: "needs_you", updatedAt: 20 });
    lane("hidden", { cards: [waiting, makeCard({ id: "d", column: "done", updatedAt: 30 })] });
    // 1 waiting + 1 finished = 2 news
    expect(screen.getByText("2")).toBeInTheDocument();
    // The label names the news count for assistive tech.
    expect(screen.getByLabelText(/Open the copilot \(2 new\)/)).toBeInTheDocument();
  });

  it("opens the chat when the pill is clicked", () => {
    const props = lane("hidden");
    fireEvent.click(screen.getByLabelText(/Open the copilot/));
    expect(props.onOpen).toHaveBeenCalled();
    expect(props.onPeek).not.toHaveBeenCalled();
  });

  it("peeks when the mouse rests on the pill, not when it passes over", () => {
    vi.useFakeTimers();
    try {
      const props = lane("hidden");
      const pill = screen.getByLabelText(/Open the copilot/);
      fireEvent.mouseEnter(pill);
      fireEvent.mouseLeave(pill);
      vi.advanceTimersByTime(1000);
      expect(props.onPeek).not.toHaveBeenCalled();
      fireEvent.mouseEnter(pill);
      vi.advanceTimersByTime(400);
      expect(props.onPeek).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a real button, so Enter and Space open it too", () => {
    lane("hidden");
    const launcher = screen.getByLabelText(/Open the copilot/);
    expect(launcher.tagName).toBe("BUTTON");
    expect(launcher).toHaveAttribute("aria-expanded", "false");
  });
});

describe("CopilotLane peek", () => {
  it("shows the digest, the ask box, and a header that hides the lane", () => {
    const waiting = makeCard({ id: "w", title: "Pick a domain", column: "needs_you", updatedAt: 20 });
    const props = lane("peek", { cards: [waiting, makeCard({ id: "d", column: "done", updatedAt: 30 })] });
    expect(screen.getByText(/1 finished, 1 needs you/)).toBeInTheDocument();
    expect(screen.getByText("All quiet on the board.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask the copilot…")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Hide the copilot"));
    expect(props.onHide).toHaveBeenCalled();
  });

  it("says when nothing waits on you", () => {
    lane("peek");
    expect(screen.getByText(/0 finished, nothing waiting on you/)).toBeInTheDocument();
  });

  it("opens the chat from the header's maximize and the latest-reply card", () => {
    const props = lane("peek");
    fireEvent.click(screen.getByLabelText("Open the chat"));
    fireEvent.click(screen.getByText(/All quiet on the board\./));
    expect(props.onOpen).toHaveBeenCalledTimes(2);
  });

  it("floats above the launcher and publishes its box until it closes", () => {
    const props = lane("peek");
    const panel = document.querySelector('aside[data-copilot-lane="peek"]');
    expect(panel).toHaveStyle({ right: "16px", bottom: "108px", width: "280px" });
    expect(copilotPanel()).toMatchObject({ width: 280 });
    props.unmount();
    expect(copilotPanel()).toBeNull();
  });

  it("doesn't peek again from the launcher while the peek is up", () => {
    vi.useFakeTimers();
    try {
      const props = lane("peek");
      fireEvent.mouseEnter(screen.getByLabelText(/Open the copilot/));
      vi.advanceTimersByTime(1000);
      expect(props.onPeek).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the card that needs you", () => {
    const waiting = makeCard({ id: "w", title: "Pick a domain", column: "needs_you", updatedAt: 20 });
    const props = lane("peek", { cards: [waiting] });
    fireEvent.click(screen.getByText("Pick a domain"));
    expect(props.onOpenCard).toHaveBeenCalledWith(waiting);
  });

  it("sends a question from the ask box and opens the chat", () => {
    const props = lane("peek");
    const input = screen.getByPlaceholderText("Ask the copilot…");
    fireEvent.submit(input, { target: { value: "" } });
    expect(thread.send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "what needs me?" } });
    fireEvent.submit(input);
    expect(props.onOpen).toHaveBeenCalled();
    expect(thread.send).toHaveBeenCalledWith("what needs me?");
  });
});

describe("CopilotLane open", () => {
  it("shows the conversation and hides from the header", () => {
    const props = lane("open");
    expect(screen.getByTestId("thread")).toHaveTextContent("2 items");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Hide the copilot"));
    expect(props.onHide).toHaveBeenCalled();
  });

  it("closes from the launcher, which shows an ×", () => {
    const props = lane("open");
    fireEvent.click(screen.getByLabelText("Close the copilot"));
    expect(props.onHide).toHaveBeenCalled();
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(document.querySelector('aside[data-copilot-lane="open"]')).toHaveAttribute("data-drop-target", "copilot");
  });

  it("starts a new chat", () => {
    lane("open");
    fireEvent.click(screen.getByText("New chat"));
    expect(thread.newChat).toHaveBeenCalled();
  });

  it("turns New chat off while a reset runs", () => {
    thread.resetting = true;
    lane("open");
    expect(screen.getByText("Starting…")).toBeDisabled();
  });

  it("offers Stop while the copilot works", () => {
    thread.card = makeCard({ id: "copilot", role: "copilot", column: "running" });
    lane("open");
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("waits for the copilot's card", () => {
    thread.card = null;
    lane("open");
    expect(screen.getByText("Starting…")).toBeInTheDocument();
    expect(screen.queryByTestId("thread")).not.toBeInTheDocument();
  });
});
