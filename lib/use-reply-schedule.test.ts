// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerHandle } from "@/components/Composer";
import type { ScheduledMessage } from "@/lib/types";

const api = vi.hoisted(() => ({ schedule: vi.fn(), unschedule: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

import { STOP_SETTLE_MS } from "./optimistic-cards";
import { useReplySchedule } from "./use-reply-schedule";

function setup(handle: Partial<ComposerHandle> | null, server?: ScheduledMessage[]) {
  const composer = { current: handle as ComposerHandle | null };
  const saveDraft = vi.fn();
  const setError = vi.fn();
  const hook = renderHook(({ list }) => useReplySchedule("c1", composer, saveDraft, setError, list), { initialProps: { list: server } });
  return { ...hook, saveDraft, setError };
}

const msg = { id: "m1", text: "later" } as ScheduledMessage;

beforeEach(() => {
  vi.clearAllMocks();
  api.schedule.mockResolvedValue(undefined);
  api.unschedule.mockResolvedValue(undefined);
});

describe("useReplySchedule", () => {
  it("schedules the box's text, clears the draft and the box", async () => {
    const handle = { read: vi.fn(() => "hello"), clear: vi.fn(), focus: vi.fn() };
    const { result, saveDraft, setError } = setup(handle);
    await act(() => result.current.scheduleAt(123));
    expect(api.schedule).toHaveBeenCalledWith("c1", "hello", 123);
    expect(saveDraft).toHaveBeenCalledWith("", true);
    expect(handle.clear).toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it("reports a read that throws (an upload still running)", async () => {
    const err = new Error("Wait for the upload to finish.");
    const { result, setError } = setup({ read: () => { throw err; } });
    await act(() => result.current.scheduleAt(1));
    expect(setError).toHaveBeenCalledWith(err);
    expect(api.schedule).not.toHaveBeenCalled();
  });

  it("asks for a message when the box is empty, or there is no box", async () => {
    const handle = { read: () => "", focus: vi.fn() };
    const a = setup(handle);
    await act(() => a.result.current.scheduleAt(1));
    expect(a.setError).toHaveBeenCalledWith("Write a message first.");
    expect(handle.focus).toHaveBeenCalled();

    const b = setup(null);
    await act(() => b.result.current.scheduleAt(1));
    expect(b.setError).toHaveBeenCalledWith("Write a message first.");
  });

  it("draws the row and empties the box before the server answers, until the server's row lands", async () => {
    let resolve!: () => void;
    api.schedule.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const handle = { read: () => "hi", clear: vi.fn() };
    const { result, rerender } = setup(handle, []);
    let done!: Promise<void>;
    act(() => {
      done = result.current.scheduleAt(9);
    });
    expect(handle.clear).toHaveBeenCalled();
    expect(result.current.scheduled).toEqual([expect.objectContaining({ text: "hi", at: 9 })]);
    // A pending row has no id on the server, so its X does nothing yet.
    act(() => result.current.unschedule(result.current.scheduled[0]!.id));
    expect(api.unschedule).not.toHaveBeenCalled();
    rerender({ list: [{ id: "s1", text: "hi ", at: 9 }] });
    expect(result.current.scheduled).toEqual([{ id: "s1", text: "hi ", at: 9 }]);
    await act(async () => {
      resolve();
      await done;
    });
  });

  it("drops the drawn row after the server took it, so it can't linger", async () => {
    vi.useFakeTimers();
    const { result } = setup({ read: () => "hi", clear: vi.fn() });
    await act(() => result.current.scheduleAt(1));
    expect(result.current.scheduled).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(STOP_SETTLE_MS);
    });
    expect(result.current.scheduled).toEqual([]);
    vi.useRealTimers();
  });

  it("on a server failure takes the row back and puts the text back in an empty box", async () => {
    api.schedule.mockRejectedValue(new Error("nope"));
    const handle = { read: () => "hi", clear: vi.fn(), isEmpty: () => true, write: vi.fn() };
    const { result, setError, saveDraft } = setup(handle);
    await act(() => result.current.scheduleAt(1));
    expect(setError).toHaveBeenCalledWith(expect.any(Error));
    expect(handle.write).toHaveBeenCalledWith("hi");
    expect(saveDraft).toHaveBeenLastCalledWith("hi", true);
    expect(result.current.scheduled).toEqual([]);
  });

  it("on a server failure leaves a box you've typed in since alone", async () => {
    api.schedule.mockRejectedValue(new Error("nope"));
    const handle = { read: () => "hi", clear: vi.fn(), isEmpty: () => false, write: vi.fn() };
    const { result } = setup(handle);
    await act(() => result.current.scheduleAt(1));
    expect(handle.write).not.toHaveBeenCalled();
  });

  it("hides an X'd row at once and brings it back if the server refuses", async () => {
    let reject!: (err: Error) => void;
    api.unschedule.mockReturnValue(new Promise((_, r) => (reject = r)));
    const { result, setError } = setup({}, [msg]);
    act(() => result.current.unschedule("m1"));
    expect(result.current.scheduled).toEqual([]);
    await act(async () => {
      reject(new Error("x"));
      await Promise.resolve();
    });
    expect(result.current.scheduled).toEqual([msg]);
    expect(setError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("unschedules, reporting a failure", async () => {
    const { result, setError } = setup({});
    act(() => result.current.unschedule("m1"));
    expect(api.unschedule).toHaveBeenCalledWith("c1", "m1");
    api.unschedule.mockRejectedValue(new Error("x"));
    await act(() => {
      result.current.unschedule("m2");
      return Promise.resolve();
    });
    expect(setError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("takes a scheduled message back into an empty box", async () => {
    const handle = { isEmpty: () => true, write: vi.fn() };
    const { result, setError } = setup(handle);
    act(() => result.current.takeBackScheduled(msg));
    expect(handle.write).toHaveBeenCalledWith("later");
    expect(api.unschedule).toHaveBeenCalledWith("c1", "m1");
    api.unschedule.mockRejectedValue(new Error("x"));
    await act(() => {
      result.current.takeBackScheduled(msg);
      return Promise.resolve();
    });
    expect(setError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("won't overwrite a box that has text", () => {
    const handle = { isEmpty: () => false, write: vi.fn() };
    const { result, setError } = setup(handle);
    act(() => result.current.takeBackScheduled(msg));
    expect(setError).toHaveBeenCalledWith("Clear the box first to edit a scheduled message.");
    expect(handle.write).not.toHaveBeenCalled();
    expect(api.unschedule).not.toHaveBeenCalled();
  });
});
