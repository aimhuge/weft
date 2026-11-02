import { useState } from "react";

// The prompt on screen that was already answered here, so a second click can't answer it (or the next one) again.
// A prompt that left and came back (weft.zip draws an answer at once, lib/web-answers.ts, and a failed one returns
// it) can be answered again: the flag clears whenever the prompt on screen changes.
export function useAnsweredPrompt(pendingId: string | undefined) {
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const [shown, setShown] = useState(pendingId);
  if (shown !== pendingId) {
    setShown(pendingId);
    setAnsweredId(null);
  }
  return { answered: answeredId !== null && answeredId === pendingId, setAnsweredId };
}
