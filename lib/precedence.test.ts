import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pending, Session } from "./runner-state";
import type { Card } from "./types";

const cards = new Map<string, Card>();
const sessions = new Map<string, Session>();
const settle = vi.fn();
const steer = vi.fn();
const canSteer = vi.fn((s: Session | undefined) => Boolean(s));
const waitPermission = vi.fn();
const waitingOn = vi.fn(() => undefined as { id: string; title: string; claim: string } | undefined);
const liveWaitTargets = vi.fn(() => [] as { id: string; holderId: string }[]);
const wouldGridlock = vi.fn(() => false);
const updateCard = vi.fn((id: string, patch: Partial<Card>) => cards.set(id, { ...cards.get(id)!, ...patch }));

vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id), updateCard }));
vi.mock("./runner-pending", () => ({ settle }));
vi.mock("./runner-state", () => ({ sessions }));
vi.mock("./runner-steer", () => ({ canSteer, steer }));
vi.mock("./permission-wait", () => ({ waitPermission, waitingOn, liveWaitTargets }));
vi.mock("./wait-chain", () => ({ wouldGridlock }));

const { putFirst, putHolderFirst, yieldMessage } = await import("./precedence");

const holder = { id: "b", title: "Restyle", claim: "/repo/Login.tsx#Form" };

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: id === "a" ? "Fix login" : "Restyle", prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...over };
}

function pending(over: Partial<Pending> = {}): Pending {
  return { id: "p1", index: 0, toolName: "Edit", title: "t", input: {}, why: { category: "same-code", detail: "d", holder }, waiting: true, resolve: vi.fn(), ...over };
}

beforeEach(() => {
  cards.clear();
  sessions.clear();
  vi.clearAllMocks();
  // The gridlock answer is per-test: clearAllMocks() keeps an implementation set by mockReturnValue.
  wouldGridlock.mockReturnValue(false);
  waitingOn.mockReturnValue(undefined);
});

describe("putFirst", () => {
  it("claims the whole file, makes the holder yield it, tells the holder and goes ahead", () => {
    cards.set("a", card("a", { claims: ["/repo/other.ts#x"], yields: [{ to: "b", file: "/repo/Login.tsx" }, { to: "c", file: "/repo/z.ts" }] }));
    cards.set("b", card("b", { yields: [{ to: "a", file: "/repo/Login.tsx" }] }));
    sessions.set("a", { pending: [pending()] } as unknown as Session);
    const holderSession = { pending: [] } as unknown as Session;
    sessions.set("b", holderSession);
    putFirst("a", "p1");
    expect(cards.get("a")).toMatchObject({ claims: ["/repo/Login.tsx#*", "/repo/other.ts#x"], yields: [{ to: "c", file: "/repo/z.ts" }] });
    expect(cards.get("b")?.yields).toEqual([{ to: "a", file: "/repo/Login.tsx" }]);
    expect(steer).toHaveBeenCalledWith("b", holderSession, yieldMessage("Fix login", "/repo/Login.tsx"));
    expect(settle).toHaveBeenCalledWith("a", true, undefined, "p1");
  });

  it("keeps the claims it has when the file is already claimed, and skips a holder it can't steer or find", () => {
    cards.set("a", card("a", { claims: ["/repo/Login.tsx#*"] }));
    cards.set("b", card("b"));
    sessions.set("a", { pending: [pending()] } as unknown as Session);
    putFirst("a", "p1");
    expect(cards.get("a")?.claims).toEqual(["/repo/Login.tsx#*"]);
    expect(steer).not.toHaveBeenCalled();
    cards.delete("b");
    cards.delete("a");
    sessions.set("a", { pending: [pending()] } as unknown as Session);
    putFirst("a", "p1");
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it("names another card when the first card is gone", () => {
    cards.set("b", card("b"));
    sessions.set("a", { pending: [pending()] } as unknown as Session);
    sessions.set("b", { pending: [] } as unknown as Session);
    putFirst("a", "p1");
    expect(steer.mock.calls[0]?.[2]).toContain("‘another card’");
  });

  it("refuses a request that's gone or that no card holds", () => {
    expect(() => putFirst("a", "p1")).toThrow("isn't waiting anymore");
    sessions.set("a", { pending: [pending({ why: { category: "mode", detail: "d" } })] } as unknown as Session);
    expect(() => putFirst("a", "p1")).toThrow("Only an edit another card is holding");
  });
});

describe("putHolderFirst", () => {
  it("leaves the file to the holder and waits for it, instead of going ahead", () => {
    cards.set("a", card("a", { yields: [{ to: "c", file: "/repo/z.ts" }] }));
    cards.set("b", card("b"));
    sessions.set("a", { pending: [pending()] } as unknown as Session);
    // The wait really happened, so the yield stays.
    waitingOn.mockReturnValue(holder);
    putHolderFirst("a", "p1");
    // This card leaves the file to the holder: its own later edits there wait on the holder.
    expect(cards.get("a")?.yields).toEqual([{ to: "c", file: "/repo/z.ts" }, { to: "b", file: "/repo/Login.tsx" }]);
    // And the held request stays held until the holder lets go.
    expect(waitPermission).toHaveBeenCalledWith("a", "p1");
    expect(settle).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
  });

  it("takes the yield back when the wait was refused and the request isn't waiting", () => {
    cards.set("a", card("a"));
    cards.set("b", card("b"));
    sessions.set("a", { pending: [pending()] } as unknown as Session);
    // The holder let go in between, so the wait didn't happen.
    waitingOn.mockReturnValue(undefined);
    putHolderFirst("a", "p1");
    expect(waitPermission).toHaveBeenCalledWith("a", "p1");
    expect(cards.get("a")?.yields).toEqual([]);
  });

  it("goes ahead instead of yielding when waiting on the holder would close a loop", () => {
    cards.set("a", card("a"));
    cards.set("b", card("b"));
    sessions.set("a", { pending: [pending()] } as unknown as Session);
    // The holder is already waiting on this card: waiting back would leave both stuck.
    wouldGridlock.mockReturnValue(true);
    putHolderFirst("a", "p1");
    // The wait is refused, so the card goes ahead — and the file is not yielded to the holder.
    expect(waitPermission).toHaveBeenCalledWith("a", "p1");
    expect(cards.get("a")?.yields).toBeUndefined();
    expect(settle).not.toHaveBeenCalled();
  });

  it("refuses a request that's gone or that no card holds", () => {
    expect(() => putHolderFirst("a", "p1")).toThrow("isn't waiting anymore");
    sessions.set("a", { pending: [pending({ why: { category: "mode", detail: "d" } })] } as unknown as Session);
    expect(() => putHolderFirst("a", "p1")).toThrow("Only an edit another card is holding");
  });
});

describe("yieldMessage", () => {
  it("names who goes first and the file", () => {
    expect(yieldMessage("Fix login", "/repo/Login.tsx")).toMatch(/put card ‘Fix login’ first on Login\.tsx\. Leave Login\.tsx to it/);
  });
});
