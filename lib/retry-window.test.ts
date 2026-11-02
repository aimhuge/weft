import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./runner-state";
import { backToAuto, retried, stepOut, untilBackInAuto, WINDOW_MS } from "./retry-window";

// The moment the CLI spends out of auto mode for a call you allowed once: opened by that call's hook, closed when
// it has run, when the turn ends, or after WINDOW_MS, whichever comes first.

function live(mode = "auto") {
  const setPermissionMode = vi.fn((m: string) => (m === "fail" ? Promise.reject(new Error("closed")) : Promise.resolve()));
  const s = { spec: { permissionMode: mode }, query: { setPermissionMode } } as unknown as Session;
  return { s, setPermissionMode };
}

afterEach(() => vi.useRealTimers());

describe("stepOut", () => {
  it("does nothing outside auto mode or with no live CLI", async () => {
    const { s, setPermissionMode } = live("default");
    await stepOut(s, "a");
    expect(setPermissionMode).not.toHaveBeenCalled();
    const idle = { spec: { permissionMode: "auto" } } as unknown as Session;
    await stepOut(idle, "a");
    expect(idle.retryWindow).toBeUndefined();
  });

  it("opens one window for several granted calls and closes it after the last has run", async () => {
    const { s, setPermissionMode } = live();
    await stepOut(s, "a");
    await stepOut(s, "b");
    expect(setPermissionMode.mock.calls).toEqual([["default"]]);
    retried(s, "other");
    retried(s, "a");
    expect(s.retryWindow).toBeDefined();
    retried(s, "b");
    await untilBackInAuto(s);
    expect(s.retryWindow).toBeUndefined();
    await vi.waitFor(() => expect(setPermissionMode).toHaveBeenLastCalledWith("auto"));
    retried(s, "b");
  });

  it("closes by itself after WINDOW_MS if the call never reports back", async () => {
    vi.useFakeTimers();
    const { s, setPermissionMode } = live();
    await stepOut(s, "a");
    const closed = untilBackInAuto(s);
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    await closed;
    expect(setPermissionMode).toHaveBeenLastCalledWith("auto");
    expect(s.retryWindow).toBeUndefined();
  });

  it("goes on even when the CLI refuses a mode change", async () => {
    const { s, setPermissionMode } = live();
    setPermissionMode.mockReturnValueOnce(Promise.reject(new Error("closed")));
    await stepOut(s, "a");
    s.spec.permissionMode = "fail" as Session["spec"]["permissionMode"];
    await backToAuto(s);
    expect(s.retryWindow).toBeUndefined();
  });
});

describe("untilBackInAuto", () => {
  it("settles at once with no window open", async () => {
    await expect(untilBackInAuto(live().s)).resolves.toBeUndefined();
    await backToAuto(live().s);
  });
});
