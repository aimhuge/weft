"use client";

// The themes you prompted up, for Settings → Appearance: loaded when it opens, and polled while a
// thread is still painting one, so the new tile shows up (and is picked) the moment theme.json lands.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client";
import { CUSTOM_PREFIX, type CustomTheme } from "./custom-theme";
import { savedTheme, setCustomTheme } from "./theme";

export const THEME_POLL_MS = 4000;

export function useCustomThemes(onArrive: (theme: CustomTheme) => void) {
  const [themes, setThemes] = useState<CustomTheme[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const waiting = useRef<string[]>([]);

  const take = useCallback((list: CustomTheme[]) => {
    setThemes(list);
    // A thread may have repainted the theme you're on: keep its saved palette current.
    const active = list.find((t) => savedTheme() === `${CUSTOM_PREFIX}${t.id}`);
    if (active) setCustomTheme(active);
    const arrived = list.filter((t) => waiting.current.includes(t.id));
    if (!arrived.length) return;
    waiting.current = waiting.current.filter((id) => !arrived.some((t) => t.id === id));
    setPending(waiting.current);
    for (const t of arrived) onArrive(t);
  }, [onArrive]);

  // A failed load keeps the list you have; the next poll tries again.
  const load = useCallback(() => api.themes().then((r) => take(r.themes), () => undefined), [take]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!pending.length) return;
    const timer = setInterval(() => void load(), THEME_POLL_MS);
    return () => clearInterval(timer);
  }, [pending.length, load]);

  const expect = useCallback((id: string) => {
    waiting.current = [...waiting.current, id];
    setPending(waiting.current);
  }, []);
  return { themes, pending, expect };
}
