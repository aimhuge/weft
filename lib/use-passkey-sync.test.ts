// @vitest-environment jsdom
// The board-wide passkey sync (lib/use-passkey-sync.ts): one sync at a time, one timer however many watch, and the
// list of workers that haven't confirmed, shared.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sync = vi.hoisted(() => vi.fn(() => Promise.resolve(["w1"])));
vi.mock("./passkey-sync", () => ({ syncPasskeys: sync }));
const signer = vi.hoisted(() => ({ on: true }));
vi.mock("./widen-signer", () => ({ canSignWiden: () => signer.on }));

const { runPasskeySync, SYNC_EVERY_MS, usePasskeySync } = await import("./use-passkey-sync");

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("runPasskeySync", () => {
  it("runs one sync at a time and shares its answer, and none without the desktop app's signer", async () => {
    let finish: (v: string[]) => void = () => {};
    const slow = vi.fn(() => new Promise<string[]>((resolve) => (finish = resolve)));
    const a = runPasskeySync(slow);
    const b = runPasskeySync(slow);
    finish(["w2"]);
    expect(await a).toEqual(["w2"]);
    expect(await b).toEqual(["w2"]);
    expect(slow).toHaveBeenCalledTimes(1);
    // A sync that throws keeps the last list.
    expect(await runPasskeySync(() => Promise.reject(new Error("x")))).toEqual(["w2"]);
    signer.on = false;
    expect(await runPasskeySync(slow)).toEqual([]);
    signer.on = true;
  });
});

describe("usePasskeySync", () => {
  it("syncs on mount and on a timer while anything watches, and shares the list", async () => {
    vi.useFakeTimers();
    const one = renderHook(() => usePasskeySync());
    const two = renderHook(() => usePasskeySync());
    await act(async () => {
      await Promise.resolve();
    });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(one.result.current).toEqual(["w1"]);
    expect(two.result.current).toEqual(["w1"]);
    await act(async () => {
      vi.advanceTimersByTime(SYNC_EVERY_MS);
      await Promise.resolve();
    });
    expect(sync).toHaveBeenCalledTimes(2);
    one.unmount();
    two.unmount();
    await act(async () => {
      vi.advanceTimersByTime(SYNC_EVERY_MS * 3);
      await Promise.resolve();
    });
    expect(sync).toHaveBeenCalledTimes(2);
    // Off (weft.zip's header): no sync.
    renderHook(() => usePasskeySync(false)).unmount();
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
