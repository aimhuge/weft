// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewCardInput } from "@/lib/client";
import { DRAFT, LAST_BACKEND, LAST_CWD } from "@/lib/new-thread";
import { useNewCardDialog } from "./use-new-card-dialog";

const api = vi.hoisted(() => ({
  settings: vi.fn(() => Promise.resolve({ defaultPermissionMode: "default", defaultBackend: "claude" })),
  warm: vi.fn(() => Promise.resolve()),
}));
vi.mock("./client", () => ({ api }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => localStorage.clear());

describe("pickInitialCwd (via useNewCardDialog)", () => {
  it("uses defaultCwd when given", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", "/repo/recent"));
    expect(result.current.cwd).toBe("/repo/web");
  });

  it("last (when not home) beats recentCwd, then home", () => {
    localStorage.setItem(LAST_CWD, "/repo/last");
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, "/repo/recent"));
    expect(result.current.cwd).toBe("/repo/last");
  });

  it("skips last when it equals home (home isn't a project)", () => {
    localStorage.setItem(LAST_CWD, "/home");
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, "/repo/recent"));
    expect(result.current.cwd).toBe("/repo/recent");
  });

  it("falls back to last even when it equals home when nothing else", () => {
    localStorage.setItem(LAST_CWD, "/home");
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.cwd).toBe("/home");
  });

  it("falls back to home when nothing else", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.cwd).toBe("/home");
  });
});

describe("useNewCardDialog", () => {
  it("starts with the last backend and its model", () => {
    localStorage.setItem(LAST_BACKEND, "puku");
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.backend).toBe("puku");
  });

  it("pickCliDefault moves to that CLI on its own default model", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => result.current.setModel("claude-opus-5-5"));
    act(() => result.current.pickCliDefault("puku"));
    expect(result.current.backend).toBe("puku");
    expect(result.current.model).toBe("");
  });

  it("pickCliDefault marks the user-picked flag so settings defaults are skipped", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => result.current.pickCliDefault("puku"));
    await act(async () => {
      await Promise.resolve();
    });
    // The settings load happened, but pickCliDefault already set backend, so backend is still puku.
    expect(result.current.backend).toBe("puku");
  });

  it("pickMode marks the user-picked flag so settings defaults are skipped", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => result.current.pickMode("bypassPermissions"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.permissionMode).toBe("bypassPermissions");
  });

  it("chooseFolder warms a CLI at the new folder and clears the error", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    act(() => result.current.chooseFolder("/repo/api"));
    expect(result.current.cwd).toBe("/repo/api");
    expect(result.current.error).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.warm).toHaveBeenCalledWith({ cwd: "/repo/api", backend: "claude" });
  });

  it("promptToStart returns the prompt when there is one, or sets the error and focuses", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    let focused = false;
    let r: string | null = "";
    act(() => { r = result.current.promptToStart(() => "hello", () => { focused = true; }); });
    expect(r).toBe("hello");
    act(() => { r = result.current.promptToStart(() => "", () => { focused = true; }); });
    expect(r).toBeNull();
    expect(focused).toBe(true);
    expect(result.current.error).toBe("Write a prompt first.");
  });

  it("promptToStart catches a read error and reports it", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    let r: string | null = "x";
    act(() => { r = result.current.promptToStart(() => { throw new Error("boom"); }, () => {}); });
    expect(r).toBeNull();
    expect(result.current.error).toBe("boom");
  });

  it("submit ignores a second call while one is in flight", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    const onCreate = vi.fn<(i: NewCardInput) => Promise<void>>(() => new Promise(() => {}));
    act(() => {
      void result.current.submit(true, { stay: false, read: () => "hi", clear: () => {}, focus: () => {}, onCreate, onClose: () => {} });
    });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      void result.current.submit(true, { stay: false, read: () => "again", clear: () => {}, focus: () => {}, onCreate, onClose: () => {} });
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("submit returns early when promptToStart returns null", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    const onCreate = vi.fn<(i: NewCardInput) => Promise<void>>(() => Promise.resolve());
    await act(async () => {
      await result.current.submit(true, { stay: false, read: () => "", clear: () => {}, focus: () => {}, onCreate, onClose: () => {} });
    });
    expect(onCreate).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Write a prompt first.");
  });

  it("submit on success keeps picks, drops the draft, and closes", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    const onClose = vi.fn();
    const onCreate = vi.fn<(i: NewCardInput) => Promise<void>>(() => Promise.resolve());
    await act(async () => {
      await result.current.submit(true, { stay: false, read: () => "hi", clear: () => {}, focus: () => {}, onCreate, onClose });
    });
    expect(onCreate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem(LAST_CWD)).toBe("/repo/web");
    expect(localStorage.getItem(DRAFT)).toBeNull();
  });

  it("submit stay keeps the dialog open and resets the box", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    let cleared = false;
    let focused = false;
    const onCreate = vi.fn<(i: NewCardInput) => Promise<void>>(() => Promise.resolve());
    await act(async () => {
      await result.current.submit(true, { stay: true, read: () => "hi", clear: () => { cleared = true; }, focus: () => { focused = true; }, onCreate, onClose: vi.fn() });
    });
    expect(cleared).toBe(true);
    expect(focused).toBe(true);
    expect(result.current.started).toBe("hi");
  });

  it("saveDraft persists after the debounce window", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
      act(() => result.current.saveDraft("a draft"));
      expect(localStorage.getItem(DRAFT)).toBeNull();
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(localStorage.getItem(DRAFT)).toBe("a draft");
    } finally {
      vi.useRealTimers();
    }
  });
});
