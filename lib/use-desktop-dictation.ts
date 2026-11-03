"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PillUpdate } from "./client";
import type { useDictation } from "./use-dictation";

type Dictation = ReturnType<typeof useDictation>;

const noopSubscribe = () => () => {};
const IDLE: PillUpdate = { state: "idle", seconds: 0, level: 0 };

// The composer's mic in the desktop app: one recorder for every app, in the floating pill
// (electron/dictation-helper.cjs). The button starts it with the caret put back in the composer, so the text lands
// there, and shows the pill's state as it goes. In a browser tab (weft.zip) there's no pill, and the composer keeps
// recording on its own: `local` is returned as is.
export function useDesktopDictation(local: Dictation, focus: () => void): Dictation {
  const bridge = useSyncExternalStore(
    noopSubscribe,
    () => window.weft?.dictation,
    () => undefined,
  );
  const [pill, setPill] = useState<PillUpdate>(IDLE);

  useEffect(() => bridge?.onState((update) => setPill(update ?? IDLE)), [bridge]);

  return useMemo(() => {
    if (!bridge) return local;
    return {
      state: pill.state,
      error: null,
      seconds: pill.seconds,
      level: pill.level,
      clearError: () => {},
      toggle: () => {
        if (pill.state === "idle") focus();
        bridge.toggle();
      },
      cancel: () => bridge.cancel(),
    };
  }, [bridge, local, pill, focus]);
}
