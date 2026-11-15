// @vitest-environment jsdom
// Voice mode's pref and its keys (lib/voice-mode.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setVoiceMode, subscribeVoiceMode, VOICE_MODE_KEY, voiceAction, voiceKeyAction, voiceModeOn } from "./voice-mode";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const key = (k: string, more: Partial<{ repeat: boolean; isComposing: boolean }> = {}) => ({ key: k, repeat: false, isComposing: false, ...more });

describe("the voice mode pref", () => {
  it("is off until switched on, and sticks in localStorage until switched off", () => {
    expect(voiceModeOn()).toBe(false);
    setVoiceMode(true);
    expect(localStorage.getItem(VOICE_MODE_KEY)).toBe("1");
    expect(voiceModeOn()).toBe(true);
    setVoiceMode(false);
    expect(localStorage.getItem(VOICE_MODE_KEY)).toBeNull();
    expect(voiceModeOn()).toBe(false);
  });

  it("tells this window's listeners and other windows' (storage) until unsubscribed", () => {
    const listener = vi.fn();
    const off = subscribeVoiceMode(listener);
    setVoiceMode(true);
    window.dispatchEvent(new Event("storage"));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    setVoiceMode(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reads off and still tells listeners when storage refuses", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const listener = vi.fn();
    const off = subscribeVoiceMode(listener);
    expect(voiceModeOn()).toBe(false);
    setVoiceMode(true);
    expect(listener).toHaveBeenCalledOnce();
    off();
  });
});

describe("voiceKeyAction", () => {
  it("Space toggles: starts when idle, stops and sends while recording", () => {
    expect(voiceKeyAction(key(" "), "idle")).toBe("toggle");
    expect(voiceKeyAction(key(" "), "recording")).toBe("toggle");
  });

  it("swallows a held Space and one while transcribing", () => {
    expect(voiceKeyAction(key(" ", { repeat: true }), "recording")).toBe("swallow");
    expect(voiceKeyAction(key(" "), "transcribing")).toBe("swallow");
  });

  it("Esc cancels only a recording", () => {
    expect(voiceKeyAction(key("Escape"), "recording")).toBe("cancel");
    expect(voiceKeyAction(key("Escape"), "idle")).toBeNull();
  });

  it("leaves other keys and IME composition alone", () => {
    expect(voiceKeyAction(key("a"), "idle")).toBeNull();
    expect(voiceKeyAction(key(" ", { isComposing: true }), "idle")).toBeNull();
  });
});

describe("voiceAction", () => {
  it("sends where an empty box would Continue, and otherwise does what Enter does", () => {
    expect(voiceAction("continue")).toBe("send");
    expect(voiceAction("steer")).toBe("steer");
    expect(voiceAction("queue")).toBe("queue");
  });
});
