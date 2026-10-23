"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { folderName } from "@/lib/format";
import Icon from "./Icon";
import Tip from "./Tip";

type BacklogSummary = { root: string; count: number; active: number };

// "☰ 7" beside the uncommitted counter: the Backlog cards waiting in the project in view's repo.
// Click to start a card that plans them into sprints and starts each sprint on your OK (lib/sprint-plan.ts).
// `refresh` changes when cards move or turns end, so the count follows the board.
export default function BacklogBadge({
  cwd,
  refresh,
  onStart,
  onError,
}: {
  cwd?: string | null;
  refresh?: unknown;
  onStart: (cwd: string, prompt: string, title: string) => Promise<string | undefined>;
  onError: (err: unknown) => void;
}) {
  const [loaded, setLoaded] = useState<{ cwd: string; backlog: BacklogSummary | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cwd) return;
    let live = true;
    apiFetch(`/api/sprint?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json() as Promise<{ backlog: BacklogSummary | null }>)
      .then((d) => {
        if (live) setLoaded({ cwd, backlog: d.backlog });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cwd, refresh]);

  if (!cwd || !loaded || loaded.cwd !== cwd || !loaded.backlog) return null;
  const b = loaded.backlog;

  async function start() {
    if (busy || !cwd) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/sprint?cwd=${encodeURIComponent(cwd)}&prompt=1`);
      // A restarting dev server answers with an HTML page; treat that as no prompt rather than a SyntaxError.
      const d = (await r.json().catch(() => ({}))) as { prompt?: string; title?: string; error?: string };
      if (!d.prompt) throw new Error(d.error ?? "Nothing in Backlog to plan.");
      await onStart(cwd, d.prompt, d.title ?? "Plan the backlog into sprints");
    } finally {
      setBusy(false);
    }
  }

  const tip = `${b.count} card${b.count === 1 ? "" : "s"} in Backlog in ${folderName(b.root)}${b.active ? `, ${b.active} more at work` : ""}. Click to start a card that plans them into sprints of cards that can run side by side, and starts each sprint when you say so.`;
  return (
    <Tip text={tip}>
      <button
        onClick={() => void start().catch(onError)}
        disabled={busy}
        className="flex items-center gap-1 rounded-md px-1 py-0.5 font-mono text-[11.5px] text-muted hover:bg-hover disabled:opacity-60"
      >
        <Icon name="list" size={12} />
        {b.count}
      </button>
    </Tip>
  );
}
