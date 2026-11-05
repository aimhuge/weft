import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECK_EVERY_MS, startClock } from "./tick-clock";

// The clocks a test leaves running, cleared after each case.
const g = globalThis as unknown as { __weftClocks?: Record<string, ReturnType<typeof setInterval>>; [key: string]: unknown };

afterEach(() => {
  for (const timer of Object.values(g.__weftClocks ?? {})) clearInterval(timer);
  delete g.__weftClocks;
  for (const key of Object.keys(g)) if (/^__weft\w+Timer$/.test(key)) Reflect.deleteProperty(g, key);
  vi.restoreAllMocks();
});

describe("startClock", () => {
  it("runs the tick right away, then on the interval", () => {
    const tick = vi.fn();
    const spy = vi.spyOn(globalThis, "setInterval");
    startClock("test", tick);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(CHECK_EVERY_MS);
    (spy.mock.calls[0]?.[0] as () => void)();
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("runs a different first call when it is given one", () => {
    const tick = vi.fn();
    const first = vi.fn();
    startClock("test", tick, { first });
    expect(first).toHaveBeenCalledTimes(1);
    expect(tick).not.toHaveBeenCalled();
  });

  it("starts one clock per name", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    startClock("test", () => {});
    const calls = spy.mock.calls.length;
    startClock("test", () => {});
    expect(spy.mock.calls.length).toBe(calls);
  });

  it("starts separate clocks under different names", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    startClock("one", () => {});
    const calls = spy.mock.calls.length;
    startClock("two", () => {});
    expect(spy.mock.calls.length).toBe(calls + 1);
  });

  it("hangs the timer off a global key named after the clock", () => {
    const keys = globalThis as unknown as Record<string, unknown>;
    startClock("cron", () => {});
    expect(keys.__weftCronTimer).toBeDefined();
    delete keys.__weftCronTimer;
  });
});
