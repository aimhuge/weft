import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_MS, askMac, CLAIM_MS, MAC_AWAY, macLink, setMacLink, type MacLink } from "./worker-mac-ask";
import type { DeviceAnswer } from "./worker-registry";

let answers: (DeviceAnswer | null)[];
const askFn = vi.fn<MacLink["ask"]>(() => Promise.resolve("call-1"));
const cancelFn = vi.fn<MacLink["cancel"]>(() => Promise.resolve(true));
const link: MacLink = {
  ask: askFn,
  result: vi.fn(() => Promise.resolve(answers.length > 1 ? answers.shift()! : answers[0]!)),
  cancel: cancelFn,
  tunnelOpen: vi.fn(),
  tunnelClose: vi.fn(),
};
// A clock that moves only when the ask waits.
let clock = 0;
const wait = (ms: number) => {
  clock += ms;
  return Promise.resolve();
};
const now = () => clock;
const ask = () => askMac("c1", "tunnel_open", { a: 1 }, wait, now);

beforeEach(() => {
  vi.clearAllMocks();
  clock = 0;
  setMacLink(link);
});

describe("askMac", () => {
  it("returns the Mac's answer once it's done", async () => {
    answers = [{ status: "pending", result: null, error: null }, { status: "claimed", result: null, error: null }, { status: "done", result: { approved: true }, error: null }];
    expect(await ask()).toEqual({ approved: true });
    expect(askFn).toHaveBeenCalledWith("c1", "tunnel_open", { a: 1 });
  });

  it("reads an answer with no object as empty", async () => {
    answers = [{ status: "done", result: null, error: null }];
    expect(await ask()).toEqual({});
  });

  it("throws the Mac's error", async () => {
    answers = [{ status: "failed", result: null, error: "That address belongs to another host." }];
    await expect(ask()).rejects.toThrow("another host");
    answers = [{ status: "failed", result: null, error: null }];
    await expect(ask()).rejects.toThrow("Your Mac couldn't do that.");
  });

  it("says no Mac answered: none to ask, a call gone, or one nobody claimed in time", async () => {
    askFn.mockResolvedValueOnce(null);
    await expect(ask()).rejects.toThrow(MAC_AWAY);
    answers = [null];
    await expect(ask()).rejects.toThrow(MAC_AWAY);
    answers = [{ status: "pending", result: null, error: null }];
    await expect(ask()).rejects.toThrow(MAC_AWAY);
    expect(clock).toBeGreaterThan(CLAIM_MS);
    expect(cancelFn).toHaveBeenCalledWith("call-1");
  });

  it("gives up on a claimed call after the answer window, and keeps waiting on one it couldn't take back", async () => {
    answers = [{ status: "claimed", result: null, error: null }];
    await expect(ask()).rejects.toThrow(/hasn't answered/);
    expect(clock).toBeGreaterThan(ANSWER_MS);
    clock = 0;
    cancelFn.mockResolvedValue(false);
    answers = [{ status: "pending", result: null, error: null }];
    await expect(ask()).rejects.toThrow(/hasn't answered/);
    cancelFn.mockResolvedValue(true);
  });

  it("needs a card and a line to the Mac", async () => {
    await expect(askMac(undefined, "tunnel_open", {})).rejects.toThrow(/No card/);
    setMacLink(null);
    expect(() => macLink()).toThrow(/can't reach your Mac/);
  });

  it("waits on a real timer by default", async () => {
    answers = [{ status: "pending", result: null, error: null }, { status: "done", result: { ok: 1 }, error: null }];
    expect(await askMac("c1", "relay_create", {})).toEqual({ ok: 1 });
  });
});
