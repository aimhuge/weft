// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewCardInput } from "@/lib/client";
import { useNewCardDialog } from "./use-new-card-dialog";

// The dialog's own resolution, with the real resolveModel: a Goose row's picker value carries a
// "goose:" prefix, and the dialog has to move to Goose and hand the thread the bare id.
//
// This is the seam the collision case goes through. "puku-ai-2.8" is puku-cli's own id, so a
// value without the prefix resolves to puku; a named Goose model is handed back prefixed, and the
// prefix is what tells the two apart.

const api = vi.hoisted(() => ({
  settings: vi.fn(() => Promise.resolve({ defaultPermissionMode: "default", defaultBackend: "claude" })),
  warm: vi.fn(() => Promise.resolve()),
}));
vi.mock("./client", () => ({ api }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("the New thread dialog: a Goose row", () => {
  it("moves the thread to Goose, even when the id is another CLI's own", () => {
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));
    expect(result.current.backend).toBe("claude");

    act(() => result.current.setModel("goose:puku-ai-2.8"));

    // The bare id belongs to puku-cli's list, so only the prefix can say "this runs on Goose".
    expect(result.current.backend).toBe("goose");
  });

  it("hands the thread the bare id, not the prefixed value", async () => {
    const created: NewCardInput[] = [];
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));

    act(() => result.current.setModel("goose:puku-ai-2.8"));
    await act(async () => {
      await result.current.submit(true, {
        stay: false,
        read: () => "hello",
        clear: () => {},
        focus: () => {},
        onCreate: (input: NewCardInput) => {
          created.push(input);
          return Promise.resolve();
        },
        onClose: () => {},
      });
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.backend).toBe("goose");
    expect(created[0]!.model).toBe("puku-ai-2.8");
  });

  it("still hands puku-cli's own row to puku-cli", () => {
    // The other half of the collision: the bare id, picked from puku-cli's group, stays on
    // puku-cli. The prefix is what makes the two distinguishable, not the id.
    const { result } = renderHook(() => useNewCardDialog("/home", undefined, undefined));

    act(() => result.current.setModel("puku-ai-2.8"));

    expect(result.current.backend).toBe("puku");
  });
});
