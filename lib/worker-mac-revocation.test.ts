import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { macKeysAt } from "./worker-mac-keys";
import { checkMacRevoked, readMacState, startMacRevocationWatch } from "./worker-mac-revocation";

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-mac-revoked-"));

afterEach(() => {
  vi.useRealTimers();
});

describe("readMacState", () => {
  it("reads the database's answer, and nothing else", () => {
    expect(readMacState({ mac: "abc", revoked: true })).toEqual({ mac: "abc", revoked: true });
    expect(readMacState({ mac: null, revoked: false })).toEqual({ mac: null, revoked: false });
    expect(readMacState({ revoked: "yes" })).toBeNull();
    expect(readMacState(null)).toBeNull();
    expect(readMacState("x")).toBeNull();
  });
});

describe("checkMacRevoked", () => {
  it("marks every key the box pinned revoked when its pairing Mac was, once, and says so", async () => {
    const h = home();
    const macs = macKeysAt(h);
    macs.pin("k1");
    const log = vi.fn();
    expect(await checkMacRevoked({ read: () => Promise.resolve({ mac: "a".repeat(64), revoked: false }), macs, log })).toBe(false);
    expect(macs.pinned()).toEqual(["k1"]);
    expect(await checkMacRevoked({ read: () => Promise.resolve({ mac: "a".repeat(64), revoked: true }), macs, log })).toBe(true);
    expect(macs.pinned()).toEqual([]);
    expect(macs.held()).toEqual(["k1"]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/aaaaaaaaaaaa….*was revoked/));
    // Already marked: nothing more to say.
    expect(await checkMacRevoked({ read: () => Promise.resolve({ mac: null, revoked: true }), macs, log })).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("takes nothing from a bent answer, and names no Mac it doesn't know", async () => {
    const macs = macKeysAt(home());
    macs.pin("k1");
    const log = vi.fn();
    expect(await checkMacRevoked({ read: () => Promise.resolve("revoked"), macs, log })).toBe(false);
    expect(macs.pinned()).toEqual(["k1"]);
    expect(await checkMacRevoked({ read: () => Promise.resolve({ mac: null, revoked: true }), macs, log })).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/\(unknown…\)/));
  });
});

describe("a revocation the database takes back", () => {
  // m1mini, 2026-11-06: the database wrongly read the box's pairing Mac as revoked (a key row revoked before it was
  // linked, then linked). Once it reads "not revoked" for that Mac, the box trusts its pinned key again, on its own.
  it("lifts the mark from the key the box pinned for its pairing Mac, and says so once", async () => {
    const h = home();
    const macs = macKeysAt(h);
    macs.pin("k1");
    macs.revoke(["k1", "old-mac"]);
    const log = vi.fn();
    const mac = "f2aa".repeat(16);
    expect(await checkMacRevoked({ read: () => Promise.resolve({ mac, revoked: false }), macs, log })).toBe(false);
    expect(macs.pinned()).toEqual(["k1"]);
    // Another Mac's key it stopped trusting stays out.
    expect(macs.revoked()).toEqual(["old-mac"]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/f2aaf2aaf2aa….*isn't revoked after all/));
    await checkMacRevoked({ read: () => Promise.resolve({ mac, revoked: false }), macs, log });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("lifts nothing for a box with no pairing Mac, or when the list won't read", async () => {
    const h = home();
    const macs = macKeysAt(h);
    macs.pin("k1");
    macs.revoke(["k1"]);
    const log = vi.fn();
    await checkMacRevoked({ read: () => Promise.resolve({ mac: null, revoked: false }), macs, log });
    expect(macs.pinned()).toEqual([]);
    fs.writeFileSync(path.join(h, "mac-revoked.json"), "{");
    macs.unrevoke(["k1"]);
    expect(fs.readFileSync(path.join(h, "mac-revoked.json"), "utf8")).toBe("{");
    expect(log).not.toHaveBeenCalled();
  });

  it("never adds a key the box didn't pin", async () => {
    const macs = macKeysAt(home());
    macs.revoke(["k9"]);
    await checkMacRevoked({ read: () => Promise.resolve({ mac: "a".repeat(64), revoked: false }), macs, log: vi.fn() });
    expect(macs.pinned()).toEqual([]);
    expect(macs.revoked()).toEqual(["k9"]);
  });
});

describe("startMacRevocationWatch", () => {
  it("checks at start and every minute, says a failed read once, and stops", async () => {
    vi.useFakeTimers();
    const macs = macKeysAt(home());
    macs.pin("k1");
    const log = vi.fn();
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ mac: null, revoked: true });
    const stop = startMacRevocationWatch({ read, macs, log, everyMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/offline/));
    expect(macs.pinned()).toEqual(["k1"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(macs.pinned()).toEqual([]);
    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("checks every minute by default", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue({ mac: null, revoked: false });
    const stop = startMacRevocationWatch({ read, macs: macKeysAt(home()), log: vi.fn() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });
});
