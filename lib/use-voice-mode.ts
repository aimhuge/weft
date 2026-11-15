"use client";

import { useSyncExternalStore } from "react";
import { useDictation } from "./use-dictation";
import { setVoiceMode, subscribeVoiceMode, voiceModeOn } from "./voice-mode";

// Voice mode on or off (lib/voice-mode.ts), live in every composer that shows it.
export function useVoiceMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeVoiceMode, voiceModeOn, () => false);
  return [on, setVoiceMode];
}

export type VoiceComposer = ReturnType<typeof useVoiceComposer>;

// The phone look's voice mode for one composer: its own recorder, whose words go out as a message (onText) rather
// than into the field, so the field's mic keeps dictating as it always has. Off unless the composer has the phone look.
export function useVoiceComposer(phone: boolean, onText: (text: string) => void) {
  const [pref, setPref] = useVoiceMode();
  const recorder = useDictation(onText);
  // ⌨ while listening drops what was said: nothing goes out from a bar that is gone.
  const setOn = (next: boolean) => {
    if (!next) recorder.cancel();
    setPref(next);
  };
  return { on: phone && pref, setOn, recorder };
}
