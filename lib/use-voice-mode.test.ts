// @vitest-environment jsdom
// Voice mode's hooks (lib/use-voice-mode.ts): the shared pref, and one composer's own recorder.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cancel = vi.hoisted(() => vi.fn());
const onTexts = vi.hoisted(() => [] as ((text: string) => void)[]);
vi.mock("./use-dictation", () => ({
  useDictation: (onText: (text: string) => void) => {
    onTexts.push(onText);
    return { state: "idle", cancel };
  },
}));

import { useVoiceComposer, useVoiceMode } from "./use-voice-mode";

beforeEach(() => {
  localStorage.clear();
  cancel.mockClear();
  onTexts.length = 0;
});

describe("useVoiceMode", () => {
  it("follows the pref live, in every hook that reads it", () => {
    const a = renderHook(() => useVoiceMode());
    const b = renderHook(() => useVoiceMode());
    expect(a.result.current[0]).toBe(false);
    act(() => a.result.current[1](true));
    expect(b.result.current[0]).toBe(true);
  });
});

describe("useVoiceComposer", () => {
  it("is on only in the phone look, and hands the recorder's words to onText", () => {
    localStorage.setItem("weft-voice-mode", "1");
    const onText = vi.fn();
    const phone = renderHook(() => useVoiceComposer(true, onText));
    expect(phone.result.current.on).toBe(true);
    onTexts.at(-1)?.("hello");
    expect(onText).toHaveBeenCalledWith("hello");
    expect(renderHook(() => useVoiceComposer(false, vi.fn())).result.current.on).toBe(false);
  });

  it("switching off drops a recording; switching on doesn't touch it", () => {
    const { result } = renderHook(() => useVoiceComposer(true, vi.fn()));
    act(() => result.current.setOn(true));
    expect(cancel).not.toHaveBeenCalled();
    expect(result.current.on).toBe(true);
    act(() => result.current.setOn(false));
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.current.on).toBe(false);
  });
});
