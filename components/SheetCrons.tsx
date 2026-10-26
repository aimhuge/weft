"use client";

// The ⏰ Crons band at the foot of the list view: one row per cron, in the sheet's own cells — its name, whether
// it's on and when it runs next, its schedule, how each run starts (a fork of a thread, or fresh), its folder, and
// when it last ran. A click on its status runs it now or switches it on or off; its toggle folds open the cards its
// runs made, drawn as the board's own rows so each one opens. The band folds like the others.
import { useState } from "react";
import { describeCron } from "@/lib/cron-schedule";
import { folderName } from "@/lib/format";
import type { CronRow } from "@/lib/list-crons";
import { untilNext } from "@/lib/list-crons";
import type { CronsState } from "@/lib/use-crons";
import type { Card, Column } from "@/lib/types";
import { LIST_GRID } from "./list-grid";
import { AgeCell, Chevron, type RowNest } from "./CardRowCells";
import { SheetPopover } from "@aimhuge/sheet/client";
import "./crons.css";

export interface SheetCronsProps {
  rows: CronRow[];
  collapsed: boolean;
  onFold: () => void;
  now: number;
  crons: Pick<CronsState, "update" | "run">;
  renderRow: (card: Card, column: Column, nest?: RowNest) => React.ReactNode;
  notify?: (err: unknown) => void;
}

export default function SheetCrons({ rows, collapsed, onFold, now, crons, renderRow, notify }: SheetCronsProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  if (!rows.length) return null;
  const on = rows.filter((r) => r.cron.enabled && r.cron.nextAt !== undefined).length;
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <section className="flex flex-col">
      <div className="sheet-band sticky z-10 flex items-center text-[11px] font-semibold uppercase tracking-[0.08em] text-cron">
        <button onClick={onFold} aria-expanded={!collapsed} className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left uppercase">
          <span className="text-faint">
            <Chevron open={!collapsed} />
          </span>
          <span aria-hidden>⏰</span>
          Crons
          <span className="font-normal tabular-nums text-faint">{rows.length}</span>
          <span className="font-normal normal-case tracking-normal text-faint">{on} on</span>
          {collapsed && <span className="ml-auto font-normal normal-case tracking-normal text-faint">folded · click to show</span>}
        </button>
      </div>
      {!collapsed &&
        rows.map((row) => (
          <div key={row.cron.id} className="flex flex-col">
            <CronLine row={row} now={now} expanded={open.has(row.cron.id)} onToggle={() => toggle(row.cron.id)} crons={crons} notify={notify} />
            {open.has(row.cron.id) &&
              row.runs.map((card) => (
                <div key={card.id} className="sheet-row sheet-row-nested flex">
                  <span className="sheet-gutter" aria-hidden />
                  <div className="min-w-0 flex-1">{renderRow(card, card.column, { depth: 1, kids: 0, expanded: false, onToggle: () => {} })}</div>
                </div>
              ))}
          </div>
        ))}
    </section>
  );
}

function CronLine({ row, now, expanded, onToggle, crons, notify }: { row: CronRow; now: number; expanded: boolean; onToggle: () => void; crons: SheetCronsProps["crons"]; notify?: (err: unknown) => void }) {
  const { cron, runs } = row;
  const live = cron.enabled && cron.nextAt !== undefined;
  const last = cron.runs.at(-1)?.at ?? cron.createdAt;
  return (
    <div className="sheet-row sheet-cron-row flex" data-cron-row>
      <span className="sheet-gutter text-cron" aria-hidden>
        ⏰
      </span>
      <div className={`${LIST_GRID} w-full`}>
        <span className="flex min-w-0 items-center gap-1.5">
          {runs.length ? (
            <button aria-label={expanded ? `Fold the runs of ${cron.name}` : `Show the runs of ${cron.name}`} aria-expanded={expanded} onClick={onToggle} className={`sheet-fold ${expanded ? "text-accent" : ""}`}>
              <Chevron open={expanded} />
              <span className="text-[10px] tabular-nums">{runs.length}</span>
            </button>
          ) : (
            <span className="sheet-fold-space" aria-hidden />
          )}
          <span className={`min-w-0 truncate text-[13px] font-medium ${live ? "text-ink" : "text-muted"}`} title={cron.prompt}>
            {cron.name}
          </span>
        </span>
        <CronStatus cron={row.cron} now={now} live={live} crons={crons} notify={notify} />
        <span className="text-[11px] text-muted">
          <span className="truncate" title={cron.expr}>
            {describeCron(cron.expr)}
          </span>
        </span>
        <span className="gap-1 text-[11px]">
          <span className="sheet-agent-type text-faint">{cron.mode === "fork" ? "fork" : "fresh"}</span>
          {cron.by === "thread" && <span className="sheet-agent-type text-faint">by a thread</span>}
        </span>
        <span className="text-[11px] text-muted">
          <span className="truncate" title={cron.cwd}>
            {folderName(cron.cwd)}
          </span>
        </span>
        <AgeCell at={last} now={now} />
        <span className="justify-end text-[10.5px] tabular-nums text-faint" title={`${cron.count} runs so far`}>
          {cron.count}×
        </span>
      </div>
    </div>
  );
}

// A cron's status: on with its next run, or off. A click opens Run now and the on/off switch.
function CronStatus({ cron, now, live, crons, notify }: { cron: CronRow["cron"]; now: number; live: boolean; crons: SheetCronsProps["crons"]; notify?: (err: unknown) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const act = (job: () => Promise<unknown>) => {
    setAnchor(null);
    job().catch((err: unknown) => notify?.(err));
  };
  return (
    <span className="sheet-status-cell min-w-0 text-[11px]">
      <button
        aria-haspopup="menu"
        aria-label={`${cron.name}: run or switch`}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
        onContextMenu={(e) => {
          e.preventDefault();
          setAnchor(e.currentTarget.getBoundingClientRect());
        }}
        className={`flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left ${live ? "text-cron" : "text-faint"}`}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${live ? "bg-cron" : "bg-faint"}`} aria-hidden />
        <span className="truncate">{live && cron.nextAt !== undefined ? `On · ${untilNext(cron.nextAt, now)}` : "Off"}</span>
      </button>
      {anchor && (
        <SheetPopover anchor={anchor} width={220} label={`${cron.name}: actions`} onClose={() => setAnchor(null)}>
          <div role="menu" className="flex flex-col p-1">
            <button role="menuitem" onClick={() => act(() => crons.run(cron.id))} className="flex flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-sunken">
              <span className="text-[12px] font-medium">Run now</span>
              <span className="text-[10.5px] text-faint">A run outside its schedule</span>
            </button>
            <button role="menuitem" onClick={() => act(() => crons.update(cron.id, { enabled: !cron.enabled }))} className="flex flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-sunken">
              <span className="text-[12px] font-medium">{cron.enabled ? "Switch off" : "Switch on"}</span>
              <span className="text-[10.5px] text-faint">{cron.enabled ? "No more runs until you switch it back" : "Runs on its schedule again"}</span>
            </button>
          </div>
        </SheetPopover>
      )}
    </span>
  );
}
