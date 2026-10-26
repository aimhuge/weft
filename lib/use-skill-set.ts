"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./client";
import { withToggled } from "./skill-set-view";
import type { SkillSetView } from "./types";

export type SkillSetWhere = { cwd: string } | { card: string };

// A project's skill set or a card's, loaded while `active`, and a switch for one row (lib/skill-sets.ts).
export function useSkillSet(where: SkillSetWhere | null, active: boolean, notify: (err: unknown) => void) {
  const key = where ? ("card" in where ? `card:${where.card}` : `cwd:${where.cwd}`) : "";
  // Kept with the key it was loaded for, so another card's or folder's set never shows while this one loads.
  const [loaded, setLoaded] = useState<{ key: string; view: SkillSetView } | null>(null);
  const view = loaded?.key === key ? loaded.view : null;
  const setView = useCallback((next: SkillSetView) => setLoaded({ key, view: next }), [key]);

  // Bumped to load again, as when a skill was just installed.
  const [loads, setLoads] = useState(0);
  const reload = useCallback(() => setLoads((n) => n + 1), []);

  useEffect(() => {
    if (!where || !active) return;
    let live = true;
    api.skillSet(where).then((v) => live && setView(v), notify);
    return () => {
      live = false;
    };
    // `key` stands for `where`, which callers build fresh each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, setView, loads]);

  const toggle = useCallback(
    (name: string, on: boolean) => {
      if (!where) return;
      setLoaded((l) => (l?.key === key ? { key, view: { ...l.view, rows: withToggled(l.view.rows, name, on, "card" in where) } } : l));
      api.setSkill(where, name, on).then(setView, notify);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, notify, setView],
  );

  return { view, toggle, reload };
}
