// The host channel's calls (lib/session-line-calls.ts): a call the line couldn't send is LineDown (take the relay), one
// it sent and lost is LineLost (don't send it twice).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCalls, LineDown, LineLost } from "./session-line-calls";

afterEach(() => vi.useRealTimers());

describe("createCalls", () => {
  it("numbers each call and settles it with its own reply", async () => {
    const calls = createCalls();
    const sent: { id: number; verb: string }[] = [];
    const send = (text: string) => {
      sent.push(JSON.parse(text) as { id: number; verb: string });
    };
    const one = calls.call(send, "card.stop", { id: "c1" });
    const two = calls.call(send, "card.update", { id: "c1", body: {} });
    expect(sent.map((s) => [s.id, s.verb])).toEqual([[1, "card.stop"], [2, "card.update"]]);
    calls.reply(JSON.stringify({ id: 2, ok: false, error: "Refused." }));
    calls.reply(JSON.stringify({ id: 1, ok: true, result: { ok: true, cardId: "c1" } }));
    calls.reply(JSON.stringify({ id: 1, ok: true, result: { ok: true, cardId: "c1" } }));
    calls.reply("garbage");
    await expect(one).resolves.toEqual({ ok: true, cardId: "c1" });
    await expect(two).rejects.toThrow("Refused.");
    expect(calls.size()).toBe(0);
  });

  it("is LineDown when there's no channel, or the send throws", async () => {
    const calls = createCalls();
    await expect(calls.call(null, "card.stop", { id: "c" })).rejects.toBeInstanceOf(LineDown);
    await expect(calls.call(() => { throw new Error("closed"); }, "card.stop", { id: "c" })).rejects.toBeInstanceOf(LineDown);
  });

  it("is LineLost when the line closes or no reply comes in time", async () => {
    vi.useFakeTimers();
    const calls = createCalls(1_000);
    const lost = calls.call(() => {}, "card.stop", { id: "c" });
    calls.lost();
    await expect(lost).rejects.toBeInstanceOf(LineLost);
    const slow = calls.call(() => {}, "card.stop", { id: "c" });
    vi.advanceTimersByTime(1_000);
    await expect(slow).rejects.toThrow("dropped before it answered");
  });
});
