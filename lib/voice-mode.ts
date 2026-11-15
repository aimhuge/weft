// Simple mode's phone composer (docs/architecture/simple-mode.md, piece 1): voice mode, as on the phone. 〰 turns
// it on and the words field gives way to one wide bar, "Press Space to talk"; Space starts listening, Space again
// sends what was said, Esc drops it. It sticks for every composer, and across launches, until ⌨ switches back,
// like the phone's useVoiceMode (~/dev/weft-mobile src/hooks/useTalk.ts).
import type { DictationState } from "./use-dictation";
import type { ReplyAction } from "./reply-mode";

export const VOICE_MODE_KEY = "weft-voice-mode";
// Same-tab listeners: the storage event only reaches other windows.
const EVENT = "weft-voice-mode";

export function voiceModeOn(): boolean {
  try {
    return localStorage.getItem(VOICE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setVoiceMode(on: boolean) {
  try {
    if (on) localStorage.setItem(VOICE_MODE_KEY, "1");
    else localStorage.removeItem(VOICE_MODE_KEY);
  } catch {
    // Storage refused (private mode, a full quota): it lasts for this window only.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeVoiceMode(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

// What a key on the voice bar does: toggle (start, or stop and send), cancel the recording, or swallow it (a held
// Space repeating, or one while the words are being transcribed) so it neither scrolls the pane nor clicks the bar.
export type VoiceKey = "toggle" | "cancel" | "swallow" | null;

export function voiceKeyAction(key: { key: string; repeat: boolean; isComposing: boolean }, state: DictationState): VoiceKey {
  if (key.isComposing) return null;
  if (key.key === "Escape") return state === "recording" ? "cancel" : null;
  if (key.key !== " ") return null;
  return key.repeat || state === "transcribing" ? "swallow" : "toggle";
}

// What a spoken message does: what Enter would, except that an empty box's Continue (lib/reply-mode.ts, read before
// the words went in) is a Send now that there is something to send.
export function voiceAction(primary: ReplyAction): ReplyAction {
  return primary === "continue" ? "send" : primary;
}
