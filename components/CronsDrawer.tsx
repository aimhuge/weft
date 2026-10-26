"use client";

import { useState } from "react";
import { formOf, inputOf, runLabel } from "@/lib/cron-form";
import type { Cron } from "@/lib/cron-types";
import { cronSummary, runTone, sortCrons, TONE_CLASS, TONE_LABEL } from "@/lib/crons-view";
import type { CronsState } from "@/lib/use-crons";
import { useNow } from "@/lib/use-now";
import type { Card } from "@/lib/types";
import CronEditor from "./CronEditor";
import { Note } from "./VaultParts";
import "./crons.css";

type Props = Pick<CronsState, "crons" | "update" | "remove" | "run"> & {
  cards: readonly Card[];
  onOpenCard: (card: Card) => void;
  notify: (err: unknown) => void;
};

const ACTION = "text-[11px] font-medium text-cron hover:underline disabled:opacity-50";

function nextLine(cron: Cron, now: number): React.ReactNode {
  if (!cron.enabled) return "paused";
  if (!cron.nextAt) return "no runs left";
  return <>next <b className="font-medium text-ink">{runLabel(cron.nextAt, now)}</b></>;
}

// The last few runs as dots, coloured by what their card is doing; a click opens that run's card.
function RunDots({ cron, cards, now, onOpen }: { cron: Cron; cards: readonly Card[]; now: number; onOpen: (id: string) => void }) {
  const last = cron.runs[cron.runs.length - 1];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-faint">
      {cron.count} run{cron.count === 1 ? "" : "s"}
      {cron.runs.slice(-10).map((r) => {
        const tone = runTone(r, cards);
        return <button key={`${r.n}-${r.at}`} type="button" onClick={() => onOpen(r.cardId)} disabled={!r.cardId} title={`Run ${r.n}, ${runLabel(r.at, now)}: ${r.error ?? TONE_LABEL[tone]}`} aria-label={`Run ${r.n}: ${TONE_LABEL[tone]}`} className={`size-2 rounded-full ${TONE_CLASS[tone]}`} />;
      })}
      {last?.error && <span className="truncate text-danger">· {last.error}</span>}
    </div>
  );
}

function CronItem({ cron, cards, now, onOpenCard, act, update, remove, run }: { cron: Cron; cards: readonly Card[]; now: number; onOpenCard: (card: Card) => void; act: (fn: () => Promise<unknown>) => void } & Pick<Props, "update" | "remove" | "run">) {
  const [editing, setEditing] = useState(false);
  const source = cron.sourceId ? cards.find((c) => c.id === cron.sourceId) : undefined;
  const open = (id: string) => {
    const card = cards.find((c) => c.id === id);
    if (card) onOpenCard(card);
  };
  return (
    <li className={`border-b border-line px-3 py-2 ${cron.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => source && onOpenCard(source)} disabled={!source} className="block max-w-full truncate text-left text-[12.5px] font-semibold text-ink enabled:hover:underline">
            <span className="text-cron">⏰</span> {cron.name}
          </button>
          <p className="text-[11.5px] text-muted">{cronSummary(cron, source?.title)}</p>
          <p className="text-[11.5px] text-muted">{nextLine(cron, now)}</p>
        </div>
        <button type="button" role="switch" aria-checked={cron.enabled} aria-label={cron.enabled ? `Pause ${cron.name}` : `Turn on ${cron.name}`} onClick={() => act(() => update(cron.id, { enabled: !cron.enabled }))} className={`relative mt-0.5 h-4 w-7 shrink-0 rounded-full ${cron.enabled ? "bg-[var(--cron)]" : "bg-line-strong"}`}>
          <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${cron.enabled ? "right-0.5" : "left-0.5"}`} />
        </button>
      </div>
      {cron.runs.length > 0 && <RunDots cron={cron} cards={cards} now={now} onOpen={open} />}
      <div className="mt-1 flex gap-3">
        <button type="button" className={ACTION} onClick={() => act(() => run(cron.id))}>Run now</button>
        <button type="button" className={ACTION} onClick={() => setEditing(!editing)}>{editing ? "Close" : "Edit"}</button>
        <button type="button" className="text-[11px] font-medium text-danger hover:underline" onClick={() => window.confirm(`Delete the cron “${cron.name}”? Its run cards stay on the board.`) && act(() => remove(cron.id))}>Delete</button>
      </div>
      {editing && (
        <CronEditor
          initial={formOf(cron)}
          now={now}
          canFork={Boolean(cron.sessionId)}
          submitLabel="Save"
          onSubmit={async (form) => {
            const input = inputOf(form, {}, now);
            if ("error" in input) throw new Error(input.error);
            await update(cron.id, { prompt: input.prompt, expr: input.expr, mode: input.mode, startsAt: input.startsAt, endsAt: input.endsAt });
            setEditing(false);
          }}
        />
      )}
    </li>
  );
}

// The rail's ⏰ Crons drawer: every cron, soonest first. Each row: its schedule and next run, an on/off switch, its last
// runs as dots (a click opens that run's card and its page), Run now, Edit and Delete. Its name opens the source thread.
export default function CronsDrawer({ crons, update, remove, run, cards, onOpenCard, notify }: Props) {
  const now = useNow();
  const act = (fn: () => Promise<unknown>) => void fn().catch(notify);
  if (!crons.length) {
    return <Note>No crons yet. Open a thread and click ⏰ in its header, or hover one of your messages and click ⏰ to repeat from there.</Note>;
  }
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {sortCrons(crons).map((cron) => (
        <CronItem key={cron.id} cron={cron} cards={cards} now={now} onOpenCard={onOpenCard} act={act} update={update} remove={remove} run={run} />
      ))}
    </ul>
  );
}
