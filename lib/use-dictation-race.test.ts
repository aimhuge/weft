// @vitest-environment happy-dom
// What happens when the dictation key is pressed again while the microphone is still opening.
// The mic takes a moment to come up, and the key can be pressed twice in that window: the second
// press has to throw the recording away, not leave it running with nobody listening, and not
// open a second microphone on top of it.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FakeRecorder, flush, getUserMedia, installFakes, loadHook, trackStop } from "./dictation.harness";

const api = vi.hoisted(() => ({ dictation: vi.fn(), transcribe: vi.fn() }));
vi.mock("./client", () => ({ api }));

installFakes(api);

// A microphone that stays shut until the test opens it.
function pendingMic() {
  let openMic: (stream: unknown) => void = () => {};
  getUserMedia.mockReturnValue(new Promise((resolve) => (openMic = resolve)));
  return () => openMic({ getTracks: () => [{ stop: trackStop }] });
}

describe("the dictation key pressed while the mic is opening", () => {
  it("cancels the recording instead of leaving it running", async () => {
    const openMic = pendingMic();
    const useDictation = await loadHook();
    const hook = renderHook(() => useDictation(vi.fn()));
    act(() => hook.result.current.toggle());
    await flush();
    // Still opening: the second press cancels it.
    act(() => hook.result.current.toggle());
    await flush();
    expect(hook.result.current.state).toBe("idle");
    openMic();
    await flush();
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(trackStop).toHaveBeenCalled();
    expect(hook.result.current.state).toBe("idle");
  });

  it("does not open a second microphone", async () => {
    const openMic = pendingMic();
    const useDictation = await loadHook();
    const hook = renderHook(() => useDictation(vi.fn()));
    act(() => hook.result.current.toggle());
    await flush();
    act(() => hook.result.current.toggle());
    await flush();
    openMic();
    await flush();
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(hook.result.current.state).toBe("idle");
  });

  it("cancels with Escape too, rather than starting again", async () => {
    const openMic = pendingMic();
    const useDictation = await loadHook();
    const hook = renderHook(() => useDictation(vi.fn()));
    act(() => hook.result.current.toggle());
    await flush();
    act(() => hook.result.current.cancel());
    await flush();
    openMic();
    await flush();
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(hook.result.current.state).toBe("idle");
  });
});
