// @vitest-environment happy-dom
// The dictation shortcut, end to end: the real binding (Option+'), the real matcher, the real
// composer key handler and the real hook. A person pressing Command+Option+' has to start the
// mic, and pressing it again has to stop it.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyntheticEvent } from "react";
import { currentBinding } from "./shortcuts";
import { useComposerKeys, type TypeaheadState } from "./use-composer-keys";
import { useDictation } from "./use-dictation";

const api = vi.hoisted(() => ({ dictation: vi.fn(), transcribe: vi.fn() }));
vi.mock("./client", () => ({ api }));

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => Promise<void>) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    void Promise.resolve().then(() => this.onstop?.());
  });
  constructor() {
    FakeRecorder.instances.push(this);
  }
}

const trackStop = vi.fn();
const getUserMedia = vi.fn();

function noTypeahead(): TypeaheadState {
  return {
    query: null,
    suggestions: [],
    active: 0,
    setActive: vi.fn(),
    dismissedAt: null,
    setDismissedAt: vi.fn(),
    typeaheadOpen: false,
  };
}

// A key press as the browser reports it: the physical code, and the character macOS produced.
function press(code: string, mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, key: string) {
  return new KeyboardEvent("keydown", { code, key, cancelable: true, bubbles: true, ...mods });
}

beforeEach(() => {
  localStorage.clear();
  FakeRecorder.instances = [];
  api.dictation.mockResolvedValue({ available: true });
  api.transcribe.mockResolvedValue("hello world");
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: trackStop }, { stop: trackStop }] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", class {
    createAnalyser() {
      return { fftSize: 0, getByteTimeDomainData: () => {} };
    }
    createMediaStreamSource() {
      return { connect: vi.fn() };
    }
    close = vi.fn(() => Promise.resolve());
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => {});
}

describe("the dictation shortcut", () => {
  it("starts the mic on the default Option+' binding", async () => {
    expect(currentBinding("dictation")).toEqual({ code: "Quote", alt: true, ctrl: false, meta: false, shift: false });
    const { result } = renderHook(() => useDictation(vi.fn()));
    const { onKeyDownCapture } = renderHook(() => useComposerKeys({ typeahead: noTypeahead(), dictation: result.current, pickSkill: vi.fn() })).result.current;

    const k = press("Quote", { altKey: true }, "æ");
    act(() => onKeyDownCapture({ nativeEvent: k } as unknown as SyntheticEvent));
    await flush();
    expect(k.defaultPrevented).toBe(true);
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(result.current.state).toBe("recording");
  });

  it("starts the mic on Command+Option+' too, which is what people reach for", async () => {
    const { result } = renderHook(() => useDictation(vi.fn()));
    const { onKeyDownCapture } = renderHook(() => useComposerKeys({ typeahead: noTypeahead(), dictation: result.current, pickSkill: vi.fn() })).result.current;

    // Command+Option+' is what the shortcut has to answer to: the binding is Option+', and the
    // extra Command is the modifier people add when the bare combination is taken.
    const k = press("Quote", { altKey: true, metaKey: true }, "¡");
    act(() => onKeyDownCapture({ nativeEvent: k } as unknown as SyntheticEvent));
    await flush();
    expect(k.defaultPrevented).toBe(true);
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(result.current.state).toBe("recording");
  });

  it("stops the recording on the same key, and inserts the text", async () => {
    const onText = vi.fn();
    const { result } = renderHook(() => useDictation(onText));
    const { onKeyDownCapture } = renderHook(() => useComposerKeys({ typeahead: noTypeahead(), dictation: result.current, pickSkill: vi.fn() })).result.current;

    const down = press("Quote", { altKey: true, metaKey: true }, "¡");
    act(() => onKeyDownCapture({ nativeEvent: down } as unknown as SyntheticEvent));
    await flush();
    expect(result.current.state).toBe("recording");

    FakeRecorder.instances[0]!.ondataavailable?.({ data: new Blob(["audio"]) });
    const up = press("Quote", { altKey: true, metaKey: true }, "¡");
    act(() => onKeyDownCapture({ nativeEvent: up } as unknown as SyntheticEvent));
    await flush();
    expect(api.transcribe).toHaveBeenCalledOnce();
    expect(onText).toHaveBeenCalledWith("hello world");
    expect(result.current.state).toBe("idle");
  });

  it("leaves a bare quote to the editor", async () => {
    const { result } = renderHook(() => useDictation(vi.fn()));
    const { onKeyDownCapture } = renderHook(() => useComposerKeys({ typeahead: noTypeahead(), dictation: result.current, pickSkill: vi.fn() })).result.current;

    const k = press("Quote", {}, "'");
    act(() => onKeyDownCapture({ nativeEvent: k } as unknown as SyntheticEvent));
    await flush();
    expect(k.defaultPrevented).toBe(false);
    expect(FakeRecorder.instances).toHaveLength(0);
  });
});
