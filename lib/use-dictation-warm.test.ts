// @vitest-environment happy-dom
// The mic shows "opening" until it really captures, and stays open after a kept recording so the
// next one starts capturing at once (lib/mic.ts).
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FakeRecorder, flush, getUserMedia, installFakes, loadHook, trackStop } from "./dictation.harness";

const api = vi.hoisted(() => ({ dictation: vi.fn(), transcribe: vi.fn() }));
vi.mock("./client", () => ({ api }));

installFakes(api);

describe("opening and the warm mic", () => {
  it("is opening until the recorder starts, then reuses the open mic for the next recording", async () => {
    let open: (s: unknown) => void = () => {};
    const live = { readyState: "live", stop: trackStop };
    const stream = { getTracks: () => [live], getAudioTracks: () => [live] };
    getUserMedia.mockReturnValueOnce(new Promise((resolve) => (open = resolve)));
    const useDictation = await loadHook();
    const hook = renderHook(() => useDictation(vi.fn()));
    act(() => hook.result.current.toggle());
    await flush();
    expect(hook.result.current.opening).toBe(true);
    open(stream);
    await flush();
    expect(hook.result.current.opening).toBe(false);
    act(() => hook.result.current.toggle());
    await flush();
    expect(trackStop).not.toHaveBeenCalled();
    getUserMedia.mockClear();
    act(() => hook.result.current.toggle());
    await flush();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(FakeRecorder.instances.length).toBeGreaterThanOrEqual(2);
  });
});
