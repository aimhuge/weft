// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultsChanged, setModelFor } from "@/lib/new-thread";
import { useNewCardDialog } from "./use-new-card-dialog";

// The dialog's "the CLI follows the model" branch: when a default changed elsewhere names a model
// another CLI serves, the dialog moves to that CLI. The model lists in lib/new-thread.ts are
// disjoint today, so the branch is reached here with resolveModel stubbed to name another CLI —
// the case it defends against (a model id two CLIs serve).

const resolved = vi.hoisted(() => ({ backend: undefined as string | undefined, model: undefined as string | undefined }));

vi.mock("@/lib/new-thread", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/new-thread")>();
  return {
    ...original,
    resolveModel: (model: string) => (model && resolved.model ? { backend: resolved.backend, model: resolved.model } : undefined),
  };
});

const api = vi.hoisted(() => ({
  settings: vi.fn(() => Promise.resolve({ defaultPermissionMode: "default", defaultBackend: "claude" })),
  warm: vi.fn(() => Promise.resolve()),
}));
vi.mock("./client", () => ({ api }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resolved.backend = undefined;
  resolved.model = undefined;
});

describe("useNewCardDialog: the CLI follows the model", () => {
  it("moves to the CLI that serves a model the defaults named", () => {
    // The remembered default for Claude names a model another CLI serves.
    setModelFor("claude", "claude-sonnet-5-5");
    resolved.backend = "puku";
    resolved.model = "puku-ai-2.8";

    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.backend).toBe("claude");

    act(() => {
      defaultsChanged();
    });
    expect(result.current.backend).toBe("puku");
  });

  it("stays put when the model belongs to the CLI it is already on", () => {
    setModelFor("claude", "claude-sonnet-5-5");
    resolved.backend = "claude";
    resolved.model = "claude-sonnet-5-5";

    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    act(() => {
      defaultsChanged();
    });
    expect(result.current.backend).toBe("claude");
  });
});
