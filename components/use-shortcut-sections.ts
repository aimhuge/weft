"use client";

import { useMemo } from "react";
import { isMac, useShortcutList } from "@/lib/hotkeys";
import { shortcutSections } from "@/lib/shortcut-catalog";
import { bindingSpec, currentBinding } from "@/lib/shortcuts";

// Every shortcut in the app, in its sections: what the "?" dialog lists and the printed sheet holds.
export function useShortcutSections() {
  const registered = useShortcutList();
  const mac = isMac();
  const sections = useMemo(
    () =>
      shortcutSections(registered, {
        desktop: typeof window !== "undefined" && Boolean(window.weft),
        dictation: bindingSpec(currentBinding("dictation"), mac),
      }),
    [registered, mac],
  );
  return { sections, mac };
}
