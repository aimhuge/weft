"use client";

import { useEffect, useRef, useState } from "react";
import { describeCron } from "@/lib/cron-schedule";
import { onRepeatFrom, type CronAnchor } from "@/lib/cron-events";
import { newForm, inputOf, runLabel } from "@/lib/cron-form";
import type { Cron } from "@/lib/cron-types";
import { useCrons } from "@/lib/use-crons";
import { useEscape } from "@/lib/use-escape";
import type { Card } from "@/lib/types";
import CronEditor from "./CronEditor";
import CronSwitch from "./CronSwitch";
import Icon from "./Icon";
import "./crons.css";

// Claude Code and puku sessions can be forked (lib/crons.ts forkPoint): at a message Weft sent with an id, or else
// at the session's latest reply.
export function canForkCard(card: Card): boolean {
  return Boolean(card.sessionId && (card.backend === "claude" || card.backend === "puku"));
}

function forkLine(anchor: CronAnchor | undefined, from: string): string {
  return anchor?.id ? `Forks at “${from.slice(0, 60)}”` : "Forks the thread as it is now";
}

function CronRow({ cron, now, onToggle, onDelete }: { cron: Cron; now: number; onToggle: () => void; onDelete: () => void }) {
  return (
    <li className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sunken">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-ink">{cron.name}</p>
        <p className="truncate text-[11px] text-muted">
          {describeCron(cron.expr)} · {cron.enabled && cron.nextAt ? `next ${runLabel(cron.nextAt, now)}` : "off"} · {cron.count} runs
        </p>
      </div>
      <CronSwitch enabled={cron.enabled} label={cron.enabled ? "Pause" : "Turn on"} onToggle={onToggle} />
      <button type="button" aria-label={`Delete ${cron.name}`} onClick={onDelete} className="shrink-0 rounded p-0.5 text-faint hover:text-danger">
        <Icon name="x" size={13} />
      </button>
    </li>
  );
}

// The thread header's ⏰: put this thread on a cron. Each run is a new card, forked from the anchor message (the
// thread's last one, or the one whose "Repeat from here" was clicked) or fresh. Violet when the thread has crons.
export default function CronButton({ card, last, now }: { card: Card; last?: CronAnchor; now: number }) {
  const { crons, create, update, remove } = useCrons();
  const mine = crons.filter((c) => c.sourceId === card.id);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<CronAnchor | undefined>(last);
  const [adding, setAdding] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEscape(open, (e) => {
    e.stopPropagation();
    setOpen(false);
  });

  useEffect(
    () =>
      onRepeatFrom(card.id, (from) => {
        setAnchor(from);
        setAdding(true);
        setOpen(true);
      }),
    [card.id],
  );

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = () => {
    setAnchor(last);
    setAdding(mine.length === 0);
    setOpen(!open);
  };
  const fork = canForkCard(card);
  const from = anchor?.text ?? card.prompt;

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={toggle} title={mine.length ? `${mine.length} cron${mine.length > 1 ? "s" : ""} on this thread` : "Run this thread on a cron"} aria-label="Crons" aria-expanded={open} className={`rounded-md p-1.5 hover:bg-sunken ${mine.length ? "text-cron" : "text-muted hover:text-ink"}`}>
        <Icon name="clock" size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-[360px] rounded-lg border border-line-strong bg-panel p-3 shadow-lg">
          <p className="text-[13.5px] font-semibold text-ink">⏰ Cron this thread</p>
          {mine.length > 0 && (
            <ul className="-mx-1.5 mt-1.5 border-b border-line pb-1.5">
              {mine.map((c) => (
                <CronRow key={c.id} cron={c} now={now} onToggle={() => void update(c.id, { enabled: !c.enabled })} onDelete={() => void remove(c.id)} />
              ))}
            </ul>
          )}
          {adding ? (
            <>
              <p className="mt-1 truncate text-[11.5px] text-faint">{fork ? forkLine(anchor, from) : "Each run starts a fresh thread in this folder"}</p>
              <CronEditor
                key={anchor?.id ?? "fresh"}
                initial={newForm(from, fork ? "fork" : "fresh", now)}
                now={now}
                canFork={fork}
                submitLabel="Create cron"
                onSubmit={async (form) => {
                  const input = inputOf(form, { cardId: card.id, ...(form.mode === "fork" && anchor?.id ? { fromMessage: anchor.id } : {}) }, now);
                  if ("error" in input) throw new Error(input.error);
                  await create(input);
                  setAdding(false);
                  setOpen(false);
                }}
              />
            </>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="mt-2 text-[12px] font-medium text-cron hover:underline">
              + New cron from the last message
            </button>
          )}
        </div>
      )}
    </div>
  );
}
