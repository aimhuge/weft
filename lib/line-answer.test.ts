// Where a session line's answer arrives (lib/line-answer.ts): a Broadcast topic on a keyless client.
import { describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => ({ count: 0 }));
function fakeClient() {
  const handlers: Record<string, (msg: { payload: unknown }) => void> = {};
  const channel = { on: vi.fn((_: string, f: { event: string }, fn: (msg: { payload: unknown }) => void) => ((handlers[f.event] = fn), channel)), subscribe: vi.fn(() => channel) };
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(() => Promise.reject(new Error("gone"))) };
  return { client, channel, handlers };
}
const shared = vi.hoisted(() => ({ fake: null as ReturnType<typeof fakeClient> | null }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => (made.count++, shared.fake!.client) }));

const { lineToken, listenForAnswer } = await import("./line-answer");

describe("listenForAnswer", () => {
  it("hands each answer on the topic over, and leaves the topic", () => {
    const f = fakeClient();
    const got = vi.fn();
    const stop = listenForAnswer("worker-line:t", got, f.client as never);
    expect(f.client.channel).toHaveBeenCalledWith("worker-line:t");
    f.handlers.answer?.({ payload: { iv: "a", ct: "b" } });
    expect(got).toHaveBeenCalledWith({ iv: "a", ct: "b" });
    stop();
    expect(f.client.removeChannel).toHaveBeenCalledWith(f.channel);
  });

  it("shares one keyless client by default", () => {
    shared.fake = fakeClient();
    listenForAnswer("a", vi.fn())();
    listenForAnswer("b", vi.fn())();
    expect(made.count).toBe(1);
  });
});

describe("lineToken", () => {
  it("is 128 random bits in hex", () => {
    expect(lineToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(lineToken()).not.toBe(lineToken());
  });
});
