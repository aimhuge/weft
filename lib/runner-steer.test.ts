import { describe, expect, it, vi } from "vitest";
import type { Session } from "./runner-state";

const appendThread = vi.fn<(id: string, item: unknown) => void>();
vi.mock("./store", () => ({ appendThread: (id: string, item: unknown) => appendThread(id, item) }));
const push = vi.fn<(text: string, uuid?: string) => void>();

const { canSteer, steer, waitingInCli } = await import("./runner-steer");

const session = (over: Partial<Session> = {}, spec: Partial<Session["spec"]> = {}) =>
  ({ busy: true, stopping: false, spec: { backend: "claude", ...spec }, inbox: { push }, ...over }) as unknown as Session;

describe("canSteer", () => {
  it("takes a message mid-turn on a running Claude Code or puku turn", () => {
    expect(canSteer(session())).toBe(true);
    expect(canSteer(session({}, { backend: "puku" }))).toBe(true);
  });

  it("not when idle, stopping, the copilot, Codex or Goose", () => {
    expect(canSteer(undefined)).toBe(false);
    expect(canSteer(session({ busy: false }))).toBe(false);
    expect(canSteer(session({ stopping: true }))).toBe(false);
    expect(canSteer(session({}, { copilot: true }))).toBe(false);
    expect(canSteer(session({}, { backend: "codex" }))).toBe(false);
    expect(canSteer(session({}, { backend: "goose" }))).toBe(false);
  });
});

describe("steer", () => {
  it("pushes what the CLI gets with an id, and shows your text in the thread marked mid-turn", () => {
    const s = session();
    steer("c1", s, "skip it", "skip it\n\n(shell output)");
    expect(push.mock.calls[0]?.[0]).toBe("skip it\n\n(shell output)");
    expect(s.steered).toEqual(new Set([push.mock.calls[0]?.[1]]));
    expect(appendThread).toHaveBeenCalledWith("c1", expect.objectContaining({ kind: "user", text: "skip it", midTurn: true }));
    steer("c1", s, "and this");
    expect(push.mock.calls[1]?.[0]).toBe("and this");
    expect(s.steered?.size).toBe(2);
  });
});

describe("waitingInCli", () => {
  it("nothing sent mid-turn: nothing waits", () => {
    expect(waitingInCli(session(), ["a"])).toBe(false);
  });

  it("drops what the turn took in, and says whether any is left", () => {
    const s = session({ steered: new Set(["a", "b"]) });
    expect(waitingInCli(s, ["p", "a"])).toBe(true);
    expect(waitingInCli(s, ["b"])).toBe(false);
  });

  it("a result that doesn't list them counts them as taken in", () => {
    const s = session({ steered: new Set(["a"]) });
    expect(waitingInCli(s, undefined)).toBe(false);
    expect(s.steered?.size).toBe(0);
  });
});
