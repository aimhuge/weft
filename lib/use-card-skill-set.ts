"use client";

import { useCallback, useEffect, useState } from "react";
import { hostOf } from "./project-host";
import { hostSkillView, withToggled } from "./skill-set-view";
import type { Card, SkillSetView } from "./types";
import { useSkillSet } from "./use-skill-set";

// A card's ✦ skill set, from the host that runs it. This Mac's card reads and writes its skill set through
// /api/skill-sets (lib/use-skill-set.ts). A Weft Worker's lists the worker's own skills for the card (skills.list,
// through the card's transport) and sets one on or off as card.update { skill } (lib/host-api/card-update.ts), the
// worker working out the smallest change from its own project set.
export function useCardSkillSet(card: Card, active: boolean, notify: (err: unknown) => void) {
  const host = hostOf(card);
  const here = host.kind === "local";
  const local = useSkillSet({ card: card.id }, active && here, notify);
  const [remote, setRemote] = useState<{ id: string; view: SkillSetView } | null>(null);
  // A worker that doesn't answer (offline, asleep) is a state the chip shows, not an error to log: the read runs as the
  // card opens, so a console.error put Next's dev overlay up over every offline worker's card.
  const [failed, setFailed] = useState<{ id: string; error: string } | null>(null);
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    if (here || !active || !host.thread.listSkills) return;
    let live = true;
    host.thread.listSkills(card.id, card.cwd).then(
      (skills) => {
        if (!live) return;
        setFailed(null);
        setRemote({ id: card.id, view: hostSkillView(skills, card) });
      },
      (err: unknown) => live && setFailed({ id: card.id, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
    // The card's own changes are read once per load: a toggle moves the row itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, active, card.id, loads]);

  const toggle = useCallback(
    (name: string, on: boolean) => {
      setRemote((r) => (r?.id === card.id ? { ...r, view: { ...r.view, rows: withToggled(r.view.rows, name, on, true) } } : r));
      host.act("card.update", { id: card.id, body: { skill: { name, on } } }).catch((err: unknown) => {
        notify(err);
        setLoads((n) => n + 1);
      });
    },
    [host, card.id, notify],
  );
  const reload = useCallback(() => setLoads((n) => n + 1), []);

  if (here) return { ...local, error: null };
  return { view: remote?.id === card.id ? remote.view : null, toggle, reload, error: failed?.id === card.id ? failed.error : null };
}
