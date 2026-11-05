// @vitest-environment happy-dom
// Send later on another machine's card (lib/use-reply-schedule.ts with the thread's transport): a worker holds the
// timer, so the schedule and the X go to its transport, and one it hasn't taken yet stays drawn until it does.
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerHandle } from "@/lib/composer-handle";
import type { ScheduledMessage } from "@/lib/types";
import { STOP_SETTLE_MS } from "./optimistic-cards";
import { localTransport, ThreadTransportContext, type ThreadTransport } from "./thread-transport";
import { NO_SCHEDULE, useReplySchedule } from "./use-reply-schedule";

function setup(transport: ThreadTransport, handle: Partial<ComposerHandle> = { read: () => "later", clear: vi.fn() }, server: ScheduledMessage[] = []) {
  const composer = { current: handle as ComposerHandle };
  const setError = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => createElement(ThreadTransportContext.Provider, { value: transport }, children);
  const hook = renderHook(() => useReplySchedule("w1", composer, vi.fn(), setError, server), { wrapper });
  return { ...hook, setError };
}

afterEach(() => vi.useRealTimers());

describe("Send later through the card's host", () => {
  it("schedules on the worker, keeping the row drawn while the worker hasn't taken it", async () => {
    vi.useFakeTimers();
    let take!: () => void;
    const queued = new Promise<void>((r) => (take = r));
    const schedule = vi.fn(() => Promise.resolve({ queued }));
    const { result } = setup({ ...localTransport, desktop: false, schedule });
    await act(async () => {
      void result.current.scheduleAt(9_000);
      await Promise.resolve();
    });
    expect(schedule).toHaveBeenCalledWith("w1", "later", 9_000);
    await act(() => vi.advanceTimersByTimeAsync(STOP_SETTLE_MS * 2));
    expect(result.current.scheduled.map((m) => m.text)).toEqual(["later"]);
    await act(async () => {
      take();
      await vi.advanceTimersByTimeAsync(STOP_SETTLE_MS);
    });
    expect(result.current.scheduled).toEqual([]);
  });

  it("takes a row back on the worker, and brings it back when the worker refuses it later", async () => {
    const row = { id: "m1", text: "later", at: 1 } as ScheduledMessage;
    const unschedule = vi.fn(() => Promise.resolve({ queued: Promise.reject(new Error("gone")) }));
    const { result, setError } = setup({ ...localTransport, desktop: false, unschedule }, {}, [row]);
    await act(async () => {
      result.current.unschedule("m1");
      await Promise.resolve();
    });
    expect(unschedule).toHaveBeenCalledWith("w1", "m1");
    await act(() => Promise.resolve());
    expect(setError).toHaveBeenCalledWith(new Error("gone"));
    expect(result.current.scheduled).toEqual([row]);
  });

  it("says so where the transport can't schedule, and puts the text back", async () => {
    const handle = { read: () => "later", clear: vi.fn(), isEmpty: () => true, write: vi.fn() };
    const { result, setError } = setup({ ...localTransport, desktop: false, schedule: undefined, unschedule: undefined }, handle, [{ id: "m1", text: "x", at: 1 }]);
    await act(() => result.current.scheduleAt(9_000));
    expect(setError).toHaveBeenCalledWith(new Error(NO_SCHEDULE));
    expect(handle.write).toHaveBeenCalledWith("later");
    await act(async () => {
      result.current.unschedule("m1");
      await Promise.resolve();
    });
    expect(setError).toHaveBeenLastCalledWith(new Error(NO_SCHEDULE));
  });
});
