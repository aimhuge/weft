import { afterEach, describe, expect, it, vi } from "vitest";
import { signPatch } from "./server-patch-feed.cjs";
import { createPatcher } from "./patcher.cjs";
import { DETAILS, keyPair, make, PAYLOAD } from "./patcher.fixtures";

afterEach(() => {
  vi.useRealTimers();
});

describe("createPatcher.check", () => {
  it("stages a good patch and says it's ready", async () => {
    const { patcher, stage, notify } = make();
    await patcher.check();
    expect(patcher.state()).toMatchObject({ phase: "ready", build: "0.6.7+abc123", notes: "" });
    expect(stage).toHaveBeenCalledWith(expect.objectContaining({ build: "0.6.7+abc123" }), PAYLOAD);
    expect(notify.mock.calls[0]?.slice(0, 2)).toEqual(["Weft 0.6.7+abc123 is ready", expect.any(String)]);
  });

  it("keeps the patch's notes", async () => {
    const keys = keyPair();
    const details = { ...DETAILS, notes: "### Fixed\n- things" };
    const { patcher } = make({
      publicKey: keys.publicKeyB64,
      fetchJson: vi.fn(() => Promise.resolve(signPatch(details, keys.privateKeyB64))),
    });
    await patcher.check();
    expect(patcher.state()).toMatchObject({ phase: "ready", notes: "### Fixed\n- things" });
  });

  it("skips when the app isn't packaged", async () => {
    const { patcher, fetchJson } = make({ packaged: false });
    await patcher.check();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(patcher.state()).toEqual({ phase: "idle" });
  });

  it("skips when the build has no patch key", async () => {
    const { patcher, fetchJson } = make({ publicKey: null });
    await patcher.check();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(patcher.state()).toEqual({ phase: "idle" });
  });

  it("skips while a full update is on its way", async () => {
    const { patcher, fetchJson } = make({ busy: vi.fn(() => true) });
    await patcher.check();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(patcher.state()).toEqual({ phase: "idle" });
  });

  it("stays idle when nothing is published (a 404)", async () => {
    const { patcher, download } = make({ fetchJson: vi.fn(() => Promise.resolve(null)) });
    await patcher.check();
    expect(patcher.state()).toMatchObject({ phase: "idle", checkedAt: expect.any(Number) as number });
    expect(download).not.toHaveBeenCalled();
  });

  it("skips a patch whyNot refuses, and says why", async () => {
    const { patcher, download } = make({ readLocal: () => ({ deps: "other-hash", activeSeq: 0, bad: [] }) });
    await patcher.check();
    expect(patcher.state()).toMatchObject({ phase: "idle", skipped: "0.6.7+abc123", reason: "built against different packages" });
    expect(download).not.toHaveBeenCalled();
  });

  it("rejects a download whose sha256 doesn't match the feed", async () => {
    const { patcher, stage, log } = make({ download: vi.fn(() => Promise.resolve(Buffer.from("other bytes"))) });
    await patcher.check();
    expect(stage).not.toHaveBeenCalled();
    expect(patcher.state()).toMatchObject({ phase: "idle", error: expect.stringContaining("doesn't match its feed") as string });
    expect(log.warn).toHaveBeenCalled();
  });

  it("rejects a download of the wrong size", async () => {
    const { patcher, stage } = make({ download: vi.fn(() => Promise.resolve(Buffer.concat([PAYLOAD, Buffer.from("x")]))) });
    await patcher.check();
    expect(stage).not.toHaveBeenCalled();
    expect(patcher.state()).toMatchObject({ phase: "idle", error: expect.stringContaining("doesn't match its feed") as string });
  });

  it("goes back to idle when the feed's signature is bad", async () => {
    const keys = keyPair();
    const feed = signPatch(DETAILS, keys.privateKeyB64);
    const { patcher } = make({ publicKey: keyPair().publicKeyB64, fetchJson: vi.fn(() => Promise.resolve(feed)) });
    await patcher.check();
    expect(patcher.state()).toMatchObject({ phase: "idle", error: "patch feed: bad signature" });
  });

  it("doesn't check again while a patch is ready", async () => {
    const { patcher, fetchJson } = make();
    await patcher.check();
    await patcher.check();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("reports every state change", async () => {
    const { patcher, onChange } = make();
    await patcher.check();
    expect(onChange.mock.calls.map(([s]) => (s as { phase: string }).phase)).toEqual(["checking", "downloading", "ready"]);
  });

  it("offers the notification's own Apply button", async () => {
    const { patcher, notify, applyNow } = make();
    await patcher.check();
    const options = notify.mock.calls[0]?.[2] as { apply: () => Promise<boolean> };
    expect(await options.apply()).toBe(true);
    expect(applyNow).toHaveBeenCalledTimes(1);
  });

  it("reports a failure with no message of its own", async () => {
    // An error with no message: the patcher falls back to the error's own text.
    const bare = Object.assign(new Error("offline"), { message: "", toString: () => "offline" });
    const { patcher, log } = make({
      fetchJson: vi.fn(() => Promise.reject(bare)),
    });
    await patcher.check();
    expect(patcher.state()).toMatchObject({ phase: "idle", error: "offline" });
    expect(log.warn).toHaveBeenCalledWith("Weft patcher: offline");
  });
});

describe("createPatcher.apply", () => {
  it("does nothing when no patch is ready", async () => {
    const { patcher, applyNow } = make();
    expect(await patcher.apply()).toBe(false);
    expect(applyNow).not.toHaveBeenCalled();
  });

  it("applies now when no thread runs", async () => {
    const { patcher, applyNow, ask } = make();
    await patcher.check();
    expect(await patcher.apply()).toBe(true);
    expect(applyNow).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
    expect(patcher.state()).toMatchObject({ phase: "idle", applied: "0.6.7+abc123" });
  });

  it("asks when threads run, and switches on 'now'", async () => {
    const ask = vi.fn(() => Promise.resolve<string | null>("now"));
    const { patcher, applyNow, restartWhenIdle } = make({ countRunning: vi.fn(() => Promise.resolve(2)), ask });
    await patcher.check();
    expect(await patcher.apply()).toBe(true);
    expect(ask).toHaveBeenCalledWith("2 threads are still running", expect.any(String));
    expect(applyNow).toHaveBeenCalledTimes(1);
    expect(restartWhenIdle).not.toHaveBeenCalled();
  });

  it("says '1 thread is' for a single thread", async () => {
    const ask = vi.fn(() => Promise.resolve<string | null>("now"));
    const { patcher } = make({ countRunning: vi.fn(() => Promise.resolve(1)), ask });
    await patcher.check();
    await patcher.apply();
    expect(ask).toHaveBeenCalledWith("1 thread is still running", expect.any(String));
  });

  it("waits for the threads on 'idle', and doesn't switch now", async () => {
    const ask = vi.fn(() => Promise.resolve<string | null>("idle"));
    const restartWhenIdle = vi.fn(() => Promise.resolve());
    const { patcher, applyNow } = make({ countRunning: vi.fn(() => Promise.resolve(1)), ask, restartWhenIdle });
    await patcher.check();
    expect(await patcher.apply()).toBe(false);
    expect(restartWhenIdle).toHaveBeenCalledTimes(1);
    expect(applyNow).not.toHaveBeenCalled();
  });

  it("does nothing when the answer is neither", async () => {
    const { patcher, applyNow, restartWhenIdle } = make({
      countRunning: vi.fn(() => Promise.resolve(1)),
      ask: vi.fn(() => Promise.resolve<string | null>(null)),
    });
    await patcher.check();
    expect(await patcher.apply()).toBe(false);
    expect(applyNow).not.toHaveBeenCalled();
    expect(restartWhenIdle).not.toHaveBeenCalled();
  });

  it("applies without asking when the server can't say what's running", async () => {
    const ask = vi.fn(() => Promise.resolve<string | null>(null));
    const { patcher, applyNow } = make({ countRunning: vi.fn(() => Promise.reject(new Error("server down"))), ask });
    await patcher.check();
    expect(await patcher.apply()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(applyNow).toHaveBeenCalledTimes(1);
  });

  it("goes back to ready when applying fails", async () => {
    const { patcher } = make({ applyNow: vi.fn(() => Promise.reject(new Error("restart failed"))) });
    await patcher.check();
    expect(await patcher.apply()).toBe(false);
    expect(patcher.state()).toMatchObject({ phase: "ready", build: "0.6.7+abc123", error: "restart failed" });
  });

  it("goes back to ready when applying fails with no message of its own", async () => {
    // An error with no message: the patcher falls back to the error's own text.
    const bare = Object.assign(new Error("no server"), { message: "", toString: () => "no server" });
    const { patcher } = make({ applyNow: vi.fn(() => Promise.reject(bare)) });
    await patcher.check();
    expect(await patcher.apply()).toBe(false);
    expect(patcher.state()).toMatchObject({ phase: "ready", build: "0.6.7+abc123", error: "no server" });
  });
});

describe("createPatcher's defaults", () => {
  it("does nothing with only the essentials, and never crashes on them", async () => {
    const keys = keyPair();
    const patcher = createPatcher({
      currentVersion: "0.6.7",
      packaged: true,
      publicKey: keys.publicKeyB64,
      fetchJson: vi.fn(() => Promise.resolve(signPatch(DETAILS, keys.privateKeyB64))),
      download: vi.fn(() => Promise.resolve(PAYLOAD)),
      stage: vi.fn(() => ({ build: DETAILS.build, seq: DETAILS.seq })),
      readLocal: () => ({ deps: "deps-hash", activeSeq: 0, bad: [] }),
    });
    // The default countRunning can't say: an explicit apply still switches (nothing is known to be running),
    // but the quiet path treats an unknown count as busy and waits.
    await patcher.check();
    expect(patcher.state()).toMatchObject({ phase: "ready", build: "0.6.7+abc123" });
    expect(await patcher.applyWhenQuiet()).toBe(false);
    expect(await patcher.apply()).toBe(true);
    patcher.stop();
  });

  it("asks with the default ask when threads run and no answer comes", async () => {
    const keys = keyPair();
    const patcher = createPatcher({
      currentVersion: "0.6.7",
      packaged: true,
      publicKey: keys.publicKeyB64,
      fetchJson: vi.fn(() => Promise.resolve(signPatch(DETAILS, keys.privateKeyB64))),
      download: vi.fn(() => Promise.resolve(PAYLOAD)),
      stage: vi.fn(() => ({ build: DETAILS.build, seq: DETAILS.seq })),
      readLocal: () => ({ deps: "deps-hash", activeSeq: 0, bad: [] }),
      countRunning: vi.fn(() => Promise.resolve(1)),
    });
    await patcher.check();
    // The default ask answers nothing, so the switch waits.
    expect(await patcher.apply()).toBe(false);
    expect(patcher.state()).toMatchObject({ phase: "ready" });
    patcher.stop();
  });

  it("waits for the threads with the default restartWhenIdle", async () => {
    const keys = keyPair();
    const patcher = createPatcher({
      currentVersion: "0.6.7",
      packaged: true,
      publicKey: keys.publicKeyB64,
      fetchJson: vi.fn(() => Promise.resolve(signPatch(DETAILS, keys.privateKeyB64))),
      download: vi.fn(() => Promise.resolve(PAYLOAD)),
      stage: vi.fn(() => ({ build: DETAILS.build, seq: DETAILS.seq })),
      readLocal: () => ({ deps: "deps-hash", activeSeq: 0, bad: [] }),
      countRunning: vi.fn(() => Promise.resolve(1)),
      ask: vi.fn(() => Promise.resolve<string | null>("idle")),
    });
    await patcher.check();
    expect(await patcher.apply()).toBe(false);
    expect(patcher.state()).toMatchObject({ phase: "ready" });
    patcher.stop();
  });
});
