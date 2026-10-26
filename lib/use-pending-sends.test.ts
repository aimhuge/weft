// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadPage } from "./thread-page";
import type { ThreadItem } from "./types";
import { PENDING_SEND_MS, usePendingSends } from "./use-pending-sends";

const page = (items: ThreadItem[], start = 0): ThreadPage => ({ items, start, total: start + items.length });
const reply: ThreadItem = { kind: "assistant", text: "ok", at: 1 };

afterEach(() => vi.useRealTimers());

describe("usePendingSends", () => {
  it("draws a send at once, until the server's user item lands", async () => {
    let resolve!: () => void;
    const call = () => new Promise<void>((r) => (resolve = r));
    const { result, rerender } = renderHook(({ p }) => usePendingSends("c1", p), { initialProps: { p: page([reply], 4) } });
    expect(result.current.items).toEqual([reply]);
    let sent!: Promise<void>;
    act(() => {
      sent = result.current.track("hello", call);
    });
    expect(result.current.items.map((i) => i.kind === "user" && i.text)).toEqual([false, "hello"]);
    await act(async () => {
      resolve();
      await sent;
    });
    rerender({ p: page([reply, { kind: "user", text: "hello", at: 2 }], 4) });
    expect(result.current.items).toHaveLength(2);
  });

  it("drops a refused send and rethrows", async () => {
    const { result } = renderHook(() => usePendingSends("c1", page([])));
    await act(async () => {
      await expect(result.current.track("x", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    });
    expect(result.current.items).toEqual([]);
  });

  it("stops drawing a send the server took but never showed, and keeps sends to their own card", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ id }) => usePendingSends(id, page([])), { initialProps: { id: "c1" } });
    await act(async () => {
      expect(await result.current.track("x", () => Promise.resolve(7), 0)).toBe(7);
    });
    expect(result.current.items).toHaveLength(1);
    rerender({ id: "c2" });
    expect(result.current.items).toHaveLength(0);
    rerender({ id: "c1" });
    act(() => {
      vi.advanceTimersByTime(PENDING_SEND_MS);
    });
    expect(result.current.items).toHaveLength(0);
  });
});
