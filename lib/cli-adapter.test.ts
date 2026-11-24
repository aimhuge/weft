import { describe, expect, it, vi } from "vitest";
import { CLI_ADAPTER_CODE, cancelTurn, driveAdapter, messageText, type CliAdapter } from "./cli-adapter";
import { Inbox, type Session } from "./runner-state";

// The turn loop every CLI outside the Agent SDK shares (lib/cli-adapter.ts): one runTurn per message, the warm
// adapter's start, cancel and close around them, and the text a turn starts with.

function makeSession() {
  return { inbox: new Inbox(), abort: new AbortController(), toolIndex: new Map<string, number>([["old", 0]]) } as unknown as Session;
}

const texts = (adapter: { runTurn: { mock: { calls: unknown[][] } } }) => adapter.runTurn.mock.calls.map((c) => messageText(c[1] as never));

describe("driveAdapter", () => {
  it("runs a per-turn adapter (no start, cancel or close) once per message until the inbox closes", async () => {
    const session = makeSession();
    const adapter = { name: "Codex", runTurn: vi.fn((s: Session) => Promise.resolve(void s.toolIndex.set("t", 1))) };
    session.inbox.push("one");
    session.inbox.push("two");
    session.inbox.close();
    await driveAdapter(session, adapter);
    expect(texts(adapter)).toEqual(["one", "two"]);
    // Each turn starts with no tool rows of its own yet.
    expect((adapter.runTurn.mock.calls[0] as unknown[] | undefined)?.[2]).toBeUndefined();
    expect(cancelTurn(session)).toBe(false);
  });

  it("clears the tool index before each turn", async () => {
    const session = makeSession();
    const sizes: number[] = [];
    const adapter: CliAdapter = { name: "x", runTurn: vi.fn((s: Session) => Promise.resolve(void sizes.push(s.toolIndex.size))) };
    session.inbox.push("one");
    session.inbox.close();
    await driveAdapter(session, adapter);
    expect(sizes).toEqual([0]);
  });

  it("hands a warm adapter's state to every turn, cancels through it while running, and closes it at the end", async () => {
    const session = makeSession();
    const state = { proc: "agy" };
    let cancelled: unknown;
    let midTurn: boolean | undefined;
    const start = vi.fn(() => Promise.resolve(state));
    const runTurn = vi.fn(() => {
      midTurn = cancelTurn(session);
      return Promise.resolve();
    });
    const close = vi.fn();
    const adapter: CliAdapter<typeof state> = { name: "Antigravity", start, runTurn, cancel: (_s, st) => void (cancelled = st), close };
    session.inbox.push("go");
    session.inbox.close();
    await driveAdapter(session, adapter);
    expect(start).toHaveBeenCalledWith(session);
    expect(runTurn).toHaveBeenCalledWith(session, expect.anything(), state);
    expect(midTurn).toBe(true);
    expect(cancelled).toBe(state);
    expect(close).toHaveBeenCalledWith(session, state);
    // Once the loop is done there's nothing to cancel.
    expect(cancelTurn(session)).toBe(false);
  });

  it("stops taking messages once the session is aborted, and still closes", async () => {
    const session = makeSession();
    const adapter = { name: "x", runTurn: vi.fn(() => {
        session.abort.abort();
        return Promise.resolve();
      }), close: vi.fn() };
    session.inbox.push("one");
    session.inbox.push("two");
    await driveAdapter(session, adapter);
    expect(texts(adapter)).toEqual(["one"]);
    expect(adapter.close).toHaveBeenCalledTimes(1);
  });

  it("closes the adapter when a turn throws, and passes the error on", async () => {
    const session = makeSession();
    const adapter = { name: "x", runTurn: vi.fn().mockRejectedValue(new Error("boom")), cancel: vi.fn(), close: vi.fn(() => Promise.resolve()) };
    session.inbox.push("one");
    await expect(driveAdapter(session, adapter)).rejects.toThrow("boom");
    expect(adapter.close).toHaveBeenCalledTimes(1);
    expect(cancelTurn(session)).toBe(false);
  });
});

describe("messageText", () => {
  it("reads a string, or the text parts of a list", () => {
    expect(messageText({ message: { content: "hi" } })).toBe("hi");
    expect(messageText({ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } })).toBe("a\nb");
  });

  it("is empty with no message, no content or content that's neither", () => {
    expect(messageText({})).toBe("");
    expect(messageText({ message: {} })).toBe("");
    expect(messageText({ message: { content: 5 } })).toBe("");
  });

  it("keeps primitive text parts and drops the rest, never writing [object Object]", () => {
    const content = [null, "bare", { type: "image" }, { text: 3 }, { text: true }, { text: { nested: 1 } }, { text: undefined }, { text: "end" }];
    expect(messageText({ message: { content } })).toBe("\n\n\n3\ntrue\n\n\nend");
  });
});

it("lists its code for the runner's build fingerprint", () => {
  expect(CLI_ADAPTER_CODE).toEqual([driveAdapter, cancelTurn, messageText]);
});
