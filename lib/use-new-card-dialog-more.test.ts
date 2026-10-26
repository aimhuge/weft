// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewCardInput } from "@/lib/client";
import { defaultsChanged, LAST_BACKEND, LAST_CWD, setLastEffort, setModelFor } from "@/lib/new-thread";
import { useNewCardDialog } from "./use-new-card-dialog";

// The New thread dialog's remaining behaviour: the effort pick, the model pick that moves the CLI,
// the defaults another window changed, the agent and isolated switches, and the error path of a
// submit that fails.

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

describe("useNewCardDialog: the effort pick", () => {
  it("starts on the remembered effort and takes a new one", () => {
    setLastEffort("low");
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.effort).toBe("low");
    act(() => result.current.setEffort("max"));
    expect(result.current.effort).toBe("max");
  });

  it("takes the default effort", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => result.current.setEffort(""));
    expect(result.current.effort).toBe("");
  });
});

describe("useNewCardDialog: the model pick", () => {
  it("moves the dialog to the CLI that serves the model", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => result.current.setModel("puku-ai-2.8"));
    expect(result.current.backend).toBe("puku");
    expect(result.current.model).toBe("puku-ai-2.8");
  });

  it("remembers the pick for that CLI", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => result.current.setModel("puku-ai-2.8"));
    expect(localStorage.getItem("weft.model.puku")).toBe("puku-ai-2.8");
  });

  // The CLI's own default row: there's no model id to resolve, so the CLI stays as it is.
  it("keeps the CLI when the pick is a default model", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => result.current.setModel("codex-default"));
    expect(result.current.backend).toBe("claude");
    expect(result.current.model).toBe("codex-default");
  });
});

describe("useNewCardDialog: defaults changed elsewhere", () => {
  it("re-reads the model when the default changed and the dialog hadn't picked one", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => setModelFor("claude", "claude-sonnet-5-5"));
    expect(result.current.model).toBe("claude-sonnet-5-5");
  });

  it("keeps the dialog's own pick when the default changed", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => result.current.setModel("claude-opus-5-5"));
    act(() => setModelFor("claude", "claude-sonnet-5-5"));
    expect(result.current.model).toBe("claude-opus-5-5");
  });

  it("warms the folder's CLI on a best-effort basis, and shrugs off a failure", async () => {
    api.warm.mockRejectedValueOnce(new Error("no room"));
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    act(() => result.current.chooseFolder("/repo/api"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.warm).toHaveBeenCalledWith({ cwd: "/repo/api", backend: "claude" });
    expect(result.current.error).toBeNull();
  });

  // Each CLI remembers its own model, so a default set for another CLI doesn't move this one.
  it("keeps the CLI when the default belongs to another one", () => {
    localStorage.setItem(LAST_BACKEND, "claude");
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.backend).toBe("claude");
    act(() => setModelFor("claude", "puku-ai-2.8"));
    expect(result.current.backend).toBe("claude");
    expect(result.current.model).toBe("");
  });

  it("re-reads the effort when the default changed", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => setLastEffort("low"));
    expect(result.current.effort).toBe("low");
  });

  it("stops listening when the dialog goes away", () => {
    const { unmount } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    unmount();
    expect(() => defaultsChanged()).not.toThrow();
  });

  it("drops the pending draft timer when the dialog goes away", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
      act(() => {
        unmount();
      });
      expect(() => vi.advanceTimersByTime(300)).not.toThrow();
      expect(localStorage.getItem("weft.newThreadDraft")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useNewCardDialog: the agent and the isolated switch", () => {
  it("starts as the builder, and takes another agent", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.agent).toBe("builder");
    act(() => result.current.setAgent("copywriter"));
    expect(result.current.agent).toBe("copywriter");
  });

  it("starts shared, and toggles to isolated", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.isolated).toBe(false);
    act(() => result.current.toggleIsolated());
    expect(result.current.isolated).toBe(true);
    act(() => result.current.toggleIsolated());
    expect(result.current.isolated).toBe(false);
  });

  it("counts the prompt's length", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.promptLength).toBe(0);
    act(() => result.current.saveDraft("hello"));
    expect(result.current.promptLength).toBe(5);
  });
});

describe("useNewCardDialog: the raw setters", () => {
  it("sets the folder, the CLI and the permission mode", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    act(() => result.current.setCwd("/repo/other"));
    expect(result.current.cwd).toBe("/repo/other");
    act(() => result.current.setBackend("codex"));
    expect(result.current.backend).toBe("codex");
    act(() => result.current.setPermissionMode("acceptEdits"));
    expect(result.current.permissionMode).toBe("acceptEdits");
  });
});

describe("useNewCardDialog: submit", () => {
  it("sends the picked effort and the agent, and asks for an isolated card", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    act(() => result.current.setEffort("low"));
    act(() => result.current.setAgent("copywriter"));
    act(() => result.current.toggleIsolated());
    const onCreate = vi.fn<(i: NewCardInput) => Promise<void>>(() => Promise.resolve());
    await act(async () => {
      await result.current.submit(true, { stay: false, read: () => "hi", clear: () => {}, focus: () => {}, onCreate, onClose: () => {} });
    });
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "hi", cwd: "/repo/web", effort: "low", agent: "copywriter", isolated: true, start: true }),
    );
  });

  it("leaves out the agent and the isolated flag when they're the defaults", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    const onCreate = vi.fn<(i: NewCardInput) => Promise<void>>(() => Promise.resolve());
    await act(async () => {
      await result.current.submit(false, { stay: false, read: () => "hi", clear: () => {}, focus: () => {}, onCreate, onClose: () => {} });
    });
    const input = onCreate.mock.calls[0]?.[0];
    expect(input).not.toHaveProperty("agent");
    expect(input).not.toHaveProperty("isolated");
    expect(input?.start).toBe(false);
  });

  it("reports the error when creating the card fails, and frees the button", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    const onCreate = vi.fn<(i: NewCardInput) => Promise<void>>(() => Promise.reject(new Error("no room")));
    await act(async () => {
      await result.current.submit(true, { stay: false, read: () => "hi", clear: () => {}, focus: () => {}, onCreate, onClose: () => {} });
    });
    expect(result.current.error).toBe("no room");
    expect(result.current.busy).toBe(false);
  });
});

describe("useNewCardDialog: the settings defaults", () => {
  it("takes the server's default permission mode and CLI", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.permissionMode).toBe("default");
    expect(result.current.backend).toBe("claude");
  });

  it("keeps the user's own mode when the settings arrive", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => result.current.pickMode("bypassPermissions"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.permissionMode).toBe("bypassPermissions");
  });

  it("keeps the user's own CLI when the settings arrive", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => result.current.pickCliDefault("puku"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.backend).toBe("puku");
  });

  it("carries on when the settings fail to load", async () => {
    api.settings.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.backend).toBe("claude");
    expect(result.current.error).toBeNull();
  });
});

describe("useNewCardDialog: the draft", () => {
  it("starts on the remembered draft", () => {
    localStorage.setItem("weft.newThreadDraft", "half a thought");
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.draftInitial).toBe("half a thought");
  });

  it("starts with no draft when none was remembered", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.draftInitial).toBe("");
  });

  it("drops the draft when it is emptied, and clears the error", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
      act(() => result.current.saveDraft("a draft"));
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(localStorage.getItem("weft.newThreadDraft")).toBe("a draft");
      act(() => result.current.saveDraft("   "));
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(localStorage.getItem("weft.newThreadDraft")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useNewCardDialog: the remembered cwd", () => {
  it("remembers the folder the card was made in", async () => {
    const { result } = renderHook(() => useNewCardDialog("/home", "/repo/web", undefined));
    const onCreate = vi.fn<(i: NewCardInput) => Promise<void>>(() => Promise.resolve());
    await act(async () => {
      await result.current.submit(true, { stay: false, read: () => "hi", clear: () => {}, focus: () => {}, onCreate, onClose: () => {} });
    });
    expect(localStorage.getItem(LAST_CWD)).toBe("/repo/web");
  });
});
