// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConnectorStatus } from "./use-connector-status";

// The status a connector panel shows: the three states, the poll while a tool is working, and the two
// ways of looking again (with the loading state between, and without it).

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Status = { adding: string | null; version: string };

const status = (over: Partial<Status> = {}): Status => ({ adding: null, version: "1.0.0", ...over });

// A load that answers with whatever the test puts in the queue.
function loader() {
  const queue: Status[] = [];
  const ask = vi.fn(() => Promise.resolve(queue.shift() ?? status()));
  return { ask, queue };
}

describe("useConnectorStatus", () => {
  it("starts loading, then holds the status it found", async () => {
    const { ask, queue } = loader();
    queue.push(status({ version: "2.0.0" }));
    const { result } = renderHook(() => useConnectorStatus<Status>({ load: ask }));
    expect(result.current.load).toEqual({ kind: "loading" });
    expect(result.current.busy).toBe(true);
    await act(() => Promise.resolve());
    expect(result.current.load).toEqual({ kind: "ready", status: status({ version: "2.0.0" }) });
    expect(result.current.busy).toBe(false);
  });

  it("says what went wrong when the check fails", async () => {
    const ask = vi.fn(() => Promise.reject(new Error("no such binary")));
    const { result } = renderHook(() => useConnectorStatus<Status>({ load: ask }));
    await act(() => Promise.resolve());
    expect(result.current.load).toEqual({ kind: "error", error: "no such binary" });
  });

  it("says the failure as text when it isn't an Error", async () => {
    // A tool that fails with a plain string rather than an Error.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the branch under test
    const ask = vi.fn(() => new Promise<Status>((_resolve, reject) => reject("offline")));
    const { result } = renderHook(() => useConnectorStatus<Status>({ load: ask }));
    await act(() => Promise.resolve());
    expect(result.current.load).toEqual({ kind: "error", error: "offline" });
  });

  it("looks again with the loading state between", async () => {
    const { ask, queue } = loader();
    queue.push(status({ version: "2.0.0" }));
    const { result } = renderHook(() => useConnectorStatus<Status>({ load: ask }));
    await act(() => Promise.resolve());
    queue.push(status({ version: "3.0.0" }));
    act(() => result.current.refresh());
    expect(result.current.load).toEqual({ kind: "loading" });
    await act(() => Promise.resolve());
    expect(result.current.load).toEqual({ kind: "ready", status: status({ version: "3.0.0" }) });
  });

  it("looks again without the loading state when something ended", async () => {
    const { ask, queue } = loader();
    queue.push(status({ version: "2.0.0" }));
    const { result } = renderHook(() => useConnectorStatus<Status>({ load: ask }));
    await act(() => Promise.resolve());
    queue.push(status({ version: "3.0.0" }));
    act(() => void result.current.reload());
    expect(result.current.load).toEqual({ kind: "ready", status: status({ version: "2.0.0" }) });
    await act(() => Promise.resolve());
    expect(result.current.load).toEqual({ kind: "ready", status: status({ version: "3.0.0" }) });
  });

  it("puts a status the panel got another way in place", async () => {
    const { ask } = loader();
    const { result } = renderHook(() => useConnectorStatus<Status>({ load: ask }));
    await act(() => Promise.resolve());
    act(() => result.current.accept(status({ version: "9.0.0" })));
    expect(result.current.load).toEqual({ kind: "ready", status: status({ version: "9.0.0" }) });
  });

  it("polls while the caller says so, and stops when it doesn't", async () => {
    vi.useFakeTimers();
    const { ask, queue } = loader();
    queue.push(status({ adding: "me@gmail.com" }));
    queue.push(status({ adding: "me@gmail.com" }));
    queue.push(status());
    renderHook(() => useConnectorStatus<Status>({ load: ask, pollMs: 2000, pollWhile: (s) => s?.adding ?? null }));
    await act(() => Promise.resolve());
    expect(ask).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(ask).toHaveBeenCalledTimes(2);
    // The sign-in is over: no more polls.
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(ask).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it("doesn't poll at all without a condition", async () => {
    vi.useFakeTimers();
    const { ask } = loader();
    renderHook(() => useConnectorStatus<Status>({ load: ask, pollMs: 2000 }));
    await act(() => Promise.resolve());
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("keeps the caller's latest load, without checking again on every render", async () => {
    const first = vi.fn(() => Promise.resolve(status({ version: "1.0.0" })));
    const second = vi.fn(() => Promise.resolve(status({ version: "2.0.0" })));
    const { result, rerender } = renderHook(({ ask }) => useConnectorStatus<Status>({ load: ask }), { initialProps: { ask: first } });
    await act(() => Promise.resolve());
    expect(first).toHaveBeenCalledTimes(1);
    // A render with a new load doesn't start the check over.
    rerender({ ask: second });
    await act(() => Promise.resolve());
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(0);
    // The next check asks the newest load.
    act(() => result.current.refresh());
    await act(() => Promise.resolve());
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.current.load).toEqual({ kind: "ready", status: status({ version: "2.0.0" }) });
  });
});
