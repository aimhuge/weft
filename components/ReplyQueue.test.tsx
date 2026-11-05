// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduledMessage } from "@/lib/types";
import { ReplyQueue } from "./ReplyQueue";

afterEach(cleanup);

function renderQueue(scheduled: ScheduledMessage[], { queue = [] as string[], sending = false } = {}) {
  const props = {
    onTakeBack: vi.fn(),
    onSendScheduled: vi.fn(),
    onUnschedule: vi.fn(),
    onSendNow: vi.fn(),
    onRemove: vi.fn(),
  };
  render(<ReplyQueue scheduled={scheduled} queue={queue} paused={false} live sending={sending} now={0} {...props} />);
  return props;
}

describe("ReplyQueue", () => {
  it("offers Send now on a row held for this turn, and sends that row", async () => {
    const held = { id: "h", text: "after the turn", at: 0, afterTurn: true };
    const props = renderQueue([held]);
    expect(screen.getByText("after this turn")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Send now" }));
    expect(props.onSendScheduled).toHaveBeenCalledWith(held);
    expect(screen.getByRole("button", { name: "Send now" }).getAttribute("title")).toBe("Stop the current turn and send this now");
  });

  it("offers no Send now on a row held for a restart, a slot or a time", () => {
    renderQueue([
      { id: "r", text: "restart", at: 0, afterRestart: true },
      { id: "s", text: "slot", at: 0, forSlot: true },
      { id: "t", text: "timed", at: 0 },
    ]);
    expect(screen.queryByRole("button", { name: "Send now" })).toBeNull();
  });

  it("holds every Send now while a send is on its way", () => {
    renderQueue([{ id: "h", text: "held", at: 0, afterTurn: true }], { queue: ["queued"], sending: true });
    const buttons = screen.getAllByRole("button", { name: "Send now" });
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends a queued reply by its index", async () => {
    const props = renderQueue([], { queue: ["one"] });
    await userEvent.click(screen.getByRole("button", { name: "Send now" }));
    expect(props.onSendNow).toHaveBeenCalledWith(0);
  });
});
