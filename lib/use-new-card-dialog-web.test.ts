// @vitest-environment jsdom
// The New thread dialog's state on weft.zip (`local` false, lib/new-card-transport.ts): no Weft server here, so it
// reads no Settings and warms nothing, and only a mode you picked goes, since the Mac holds a named looser mode to its
// web rule but lets one left out fall back to its own default (lib/cloud-new-card-mode.ts).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewCardInput } from "@/lib/client";
import { useNewCardDialog } from "./use-new-card-dialog";

const api = vi.hoisted(() => ({
  settings: vi.fn(() => Promise.resolve({ defaultPermissionMode: "default", defaultBackend: "codex" })),
  warm: vi.fn(() => Promise.resolve()),
}));
vi.mock("./client", () => ({ api }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

async function submit(result: { current: ReturnType<typeof useNewCardDialog> }) {
  const onCreate = vi.fn<(input: NewCardInput) => Promise<void>>(() => Promise.resolve());
  await act(() => result.current.submit(true, { stay: false, read: () => "Go", clear: () => {}, focus: () => {}, onCreate, onClose: () => {} }));
  return onCreate.mock.calls[0]?.[0];
}

describe("useNewCardDialog on weft.zip", () => {
  it("reads no Settings and warms nothing", async () => {
    const { result } = renderHook(() => useNewCardDialog("", "mac-1\n/app", undefined, false));
    act(() => result.current.chooseFolder("mac-1\n/other"));
    await act(async () => {});
    expect(api.settings).not.toHaveBeenCalled();
    expect(api.warm).not.toHaveBeenCalled();
    expect(result.current.cwd).toBe("mac-1\n/other");
  });

  it("sends no mode until you pick one", async () => {
    const first = renderHook(() => useNewCardDialog("", "mac-1\n/app", undefined, false)).result;
    expect(await submit(first)).not.toHaveProperty("permissionMode");
    // A dialog that started a card has closed; the next one is a fresh dialog.
    const { result } = renderHook(() => useNewCardDialog("", "mac-1\n/app", undefined, false));
    act(() => result.current.pickMode("acceptEdits"));
    expect(await submit(result)).toMatchObject({ permissionMode: "acceptEdits", cwd: "mac-1\n/app" });
  });
});

describe("useNewCardDialog on weft.zip: the Mac's own start mode", () => {
  it("opens on it and follows the place, but sends none until you pick", async () => {
    const modes: Record<string, "default" | "acceptEdits"> = { "mac-1": "default", "mac-2": "acceptEdits" };
    const of = (cwd: string) => modes[cwd.split("\n")[0] ?? ""];
    const { result } = renderHook(() => useNewCardDialog("", "mac-1\n/app", undefined, false, of));
    expect(result.current.permissionMode).toBe("default");
    act(() => result.current.chooseFolder("mac-2\n/app"));
    expect(result.current.permissionMode).toBe("acceptEdits");
    expect(await submit(result)).not.toHaveProperty("permissionMode");
  });

  it("keeps a mode you picked when the place changes", () => {
    const of = (cwd: string) => (cwd.startsWith("mac-2") ? ("acceptEdits" as const) : undefined);
    const { result } = renderHook(() => useNewCardDialog("", "mac-1\n/app", undefined, false, of));
    act(() => result.current.pickMode("auto"));
    act(() => result.current.chooseFolder("mac-2\n/app"));
    expect(result.current.permissionMode).toBe("auto");
  });
});
