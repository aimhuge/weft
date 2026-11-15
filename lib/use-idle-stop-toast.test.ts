// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ServiceEntry } from "./types";
import { nextStop, stopToast, useIdleStopToast } from "./use-idle-stop-toast";

const svc = (over: Partial<ServiceEntry> = {}): ServiceEntry => ({ id: "untracked:1", kind: "other", label: "pnpm dev", state: "running", cpu: 0, memKb: 0, startedAt: 0, procs: [], ...over });

describe("stopToast", () => {
  it("names the server, its folder and its memory", () => {
    expect(stopToast(svc({ cwd: "/x/app", footprintKb: 5 * 1024 * 1024 }))).toBe("Stopping idle pnpm dev in app (5.0 GB): no visitors for 30 minutes.");
    expect(stopToast(svc({ memKb: 2048 }))).toBe("Stopping idle pnpm dev (2 MB): no visitors for 30 minutes.");
    expect(stopToast(svc())).toBe("Stopping idle pnpm dev: no visitors for 30 minutes.");
  });
});

describe("nextStop", () => {
  it("hands out each announced stop once", () => {
    const told = new Set<string>();
    const list = [svc({ id: "a" }), svc({ id: "b", stopAt: 9 }), svc({ id: "c", stopAt: 9 })];
    expect(nextStop(list, told)?.id).toBe("b");
    expect(nextStop(list, told)?.id).toBe("c");
    expect(nextStop(list, told)).toBeUndefined();
  });
});

describe("useIdleStopToast", () => {
  it("toasts an announced stop with Undo, which keeps it", () => {
    const toast = vi.fn();
    const keep = vi.fn(async () => {});
    const { rerender } = renderHook(({ list }) => useIdleStopToast(list, toast, keep), { initialProps: { list: [svc({ stopAt: 5 })] } });
    expect(toast).toHaveBeenCalledTimes(1);
    const [, action] = toast.mock.calls[0] as [string, { label: string; run: () => void }];
    expect(action.label).toBe("Undo");
    action.run();
    expect(keep).toHaveBeenCalledWith("untracked:1");
    rerender({ list: [svc({ stopAt: 5 })] });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("says nothing without a toast or a stop", () => {
    const keep = vi.fn(async () => {});
    renderHook(() => useIdleStopToast([svc({ stopAt: 5 })], undefined, keep));
    const toast = vi.fn();
    renderHook(() => useIdleStopToast([svc()], toast, keep));
    expect(toast).not.toHaveBeenCalled();
  });
});
