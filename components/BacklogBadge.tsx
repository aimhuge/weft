"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { folderName } from "@/lib/format";
import { hostFor } from "@/lib/project-host";
import type { BacklogSummary } from "@/lib/project-reads";
import { workerSprintPrompt } from "@/lib/sprint-worker";
import type { Card } from "@/lib/types";
import Icon from "./Icon";
import Tip from "./Tip";

// "☰ 7" beside the uncommitted counter: the Backlog cards waiting in the project in view's repo.
// Click to start a card that plans them into sprints and starts each sprint on your OK (lib/sprint-plan.ts).
// `refresh` changes when cards move or turns end, so the count follows the board.
export default function BacklogBadge({
  cwd,
  cards = [],
  refresh,
  onStart,
  onError,
}: {
  cwd?: string | null;
  // The board's cards: a worker project's plan is written from these, as this Mac's is from its store.
  cards?: Card[];
  refresh?: unknown;
  onStart: (cwd: string, prompt: string, title: string) => Promise<string | undefined>;
  onError: (err: unknown) => void;
}) {
  const [loaded, setLoaded] = useState<{ cwd: string; backlog: BacklogSummary | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cwd) return;
    let live = true;
    hostFor(cwd)
      .read("backlog", cwd)
      .then((backlog) => {
        if (live) setLoaded({ cwd, backlog });
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
    // This Mac writes the plan from its store and points it at its server. A host that can't take that but publishes
    // its reads (a worker) gets one from its snapshot and the board's cards, for a card there (lib/sprint-worker.ts).
    const host = hostFor(cwd);
    if (!host.can("projectActs")) {
      if (!host.can("reads") || !b.count) throw new Error("Nothing in Backlog to plan.");
      const w = workerSprintPrompt(b, cards, cwd, Date.now());
      await onStart(cwd, w.prompt, w.title);
      return;
    }
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
