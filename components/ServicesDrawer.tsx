"use client";

import { useState } from "react";
import { REFRESH_CHOICES, refreshLabel, setServicesRefreshMs } from "@/lib/services-prefs";
import { filterLaunchers } from "@/lib/dev-launchers-view";
import { filterServices, formatCpu, formatMem, serviceRow, STATE_TONE } from "@/lib/services-view";
import { summarize } from "@/lib/services-summary";
import type { useServices } from "@/lib/use-services";
import { useNow } from "@/lib/use-now";
import type { Card, MachineInfo, ServiceEntry } from "@/lib/types";
import DevLaunchers from "./DevLaunchers";
import Icon from "./Icon";
import ServicesSummary from "./ServicesSummary";
import WorkerDevServers from "./WorkerDevServers";
import { Note } from "./VaultParts";

type Services = ReturnType<typeof useServices>;
type Props = Pick<Services, "services" | "loaded" | "error" | "kill" | "restart" | "refreshMs"> & Partial<Pick<Services, "launchers" | "launch" | "workers">> & {
  // This Mac's cores and RAM, once the first list arrives.
  machine?: MachineInfo;
  // The top bar's project, or null for every project.
  project: string | null;
  // The board's cards, so a service a thread started can open that card.
  cards?: readonly Card[];
  onOpenCard?: (card: Card) => void;
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
};

const BUTTON = "rounded px-1.5 py-0.5 text-muted hover:bg-sunken disabled:opacity-50";

// The rail's Services drawer: first each working folder's dev servers to start and stop (DevLaunchers) and your
// workers' (WorkerDevServers), then how busy the Mac is, then everything Weft spawned, one row per thread CLI, dev
// server, terminal or other command, with its CPU and memory. A thread's row names its card, which a click opens.
// Expand a row for its processes; ✕ ends a service or one process.
export default function ServicesDrawer({ services, launchers = [], workers = [], launch, machine, loaded, error, kill, restart, refreshMs, project, cards = [], onOpenCard, onOpenUrl, notify }: Props) {
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  if (error && !loaded) return <Note>{error}</Note>;
  if (!loaded || !now) return <Note>Loading services…</Note>;
  const shown = filterServices(services, project);
  const summary = summarize(shown, machine);
  const act = (key: string, work: () => Promise<void>) => () => {
    setBusy(key);
    void work()
      .catch(notify)
      .finally(() => setBusy(null));
  };
  // The card behind a service, while it's still on the board and the drawer can open it.
  const cardOf = (id?: string) => (onOpenCard && id ? cards.find((c) => c.id === id) : undefined);
  const openById = onOpenCard && ((id: string) => {
    const card = cardOf(id);
    if (card) onOpenCard(card);
  });
  const toggle = (id: string) => () =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div className="flex flex-col">
      {launch && <DevLaunchers launchers={filterLaunchers(launchers, project)} launch={launch} stop={(id) => kill({ id })} onOpenCard={openById} onOpenUrl={onOpenUrl} notify={notify} />}
      <WorkerDevServers groups={workers} project={project} onOpenUrl={onOpenUrl} notify={notify} />
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted">
        <span className="flex-1 truncate text-ink" title={summary.share}>
          {summary.headline}
        </span>
        <select
          aria-label="Refresh rate"
          value={refreshMs}
          onChange={(e) => setServicesRefreshMs(Number(e.target.value))}
          className="rounded border border-line bg-panel px-1 py-0.5 text-[11px] text-ink"
        >
          {REFRESH_CHOICES.map((ms) => (
            <option key={ms} value={ms}>
              {refreshLabel(ms)}
            </option>
          ))}
        </select>
      </div>
      <ServicesSummary summary={summary} />
      {!shown.length && <Note>Nothing running{project ? " for this project" : ""}.</Note>}
      <ul className="flex flex-col gap-px px-1.5 pb-2">
        {shown.map((s) => {
          const row = serviceRow(s, now);
          const open = expanded.has(s.id);
          const card = cardOf(s.cardId);
          return (
            <li key={row.key} className="group rounded-md px-2 py-1.5 text-[12px] hover:bg-sunken">
              <div className="flex items-center gap-2">
                <span className={`size-1.5 shrink-0 rounded-full ${STATE_TONE[row.state]}`} title={row.state} />
                <ServiceName service={s} name={row.name} onOpen={card && onOpenCard && (() => onOpenCard(card))} />
                {row.canKill ? (
                  <button type="button" disabled={busy === row.key} onClick={act(row.key, () => kill({ id: s.id }))} aria-label={`End ${row.name}`} title="End" className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:bg-panel hover:text-danger focus:opacity-100 group-hover:opacity-100 disabled:opacity-50">
                    <Icon name="x" size={10} />
                  </button>
                ) : (
                  <span className="w-[14px] shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-1 pl-3.5 text-[11px] text-muted">
                {s.procs.length > 1 && (
                  <button type="button" onClick={toggle(s.id)} aria-expanded={open} aria-label="Processes" title={`${s.procs.length} processes`} className="-ml-1 flex shrink-0 items-center rounded px-0.5 tabular-nums hover:bg-panel hover:text-ink">
                    <Icon name={open ? "chevronDown" : "chevronRight"} size={9} />
                    {s.procs.length}
                  </button>
                )}
                <span className="min-w-0 flex-1 truncate" title={row.meta}>{row.meta}</span>
                {row.url && (
                  <button type="button" onClick={() => onOpenUrl(row.url ?? "")} className="shrink-0 truncate rounded px-1 text-accent hover:bg-panel" title={`Open ${row.url} in the browser pane`}>
                    {row.url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)/, "")}
                  </button>
                )}
                {row.canRestart && (
                  <button type="button" disabled={busy === row.key} onClick={act(row.key, () => restart(s.id))} className={`shrink-0 ${BUTTON} hover:text-ink`}>
                    {row.live ? "Restart" : "Start"}
                  </button>
                )}
                {row.cpu && <span className="w-9 shrink-0 text-right font-mono text-[10.5px] tabular-nums">{row.cpu}</span>}
                {row.mem && <span className="w-[52px] shrink-0 text-right font-mono text-[10.5px] tabular-nums">{row.mem}</span>}
                <span className="w-[14px] shrink-0" />
              </div>
              {row.note && <div className="pl-3.5 text-[10.5px] text-faint">{row.note}</div>}
              {open && <ProcList service={s} busy={busy} onKill={(pid) => act(`pid:${pid}`, () => kill({ pid }))()} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// A service's name: its card's title, which opens the card while it's on the board; else plain text,
// in mono when it's a bare command.
function ServiceName({ service, name, onOpen }: { service: ServiceEntry; name: string; onOpen?: (() => void) | undefined }) {
  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-ink hover:text-accent hover:underline" title={`Open the card ${name}`}>
        {name}
      </button>
    );
  }
  const bare = !service.title && (service.kind === "dev" || service.kind === "task" || service.kind === "other");
  return (
    <span className={`min-w-0 flex-1 truncate text-ink ${bare ? "font-mono text-[11.5px]" : ""}`} title={name}>
      {name}
    </span>
  );
}

// A service's processes, parent first; each but Weft's own has its own ✕.
function ProcList({ service, busy, onKill }: { service: ServiceEntry; busy: string | null; onKill: (pid: number) => void }) {
  return (
    <ul className="mt-1 ml-3.5 flex flex-col border-l border-line pl-2">
      {service.procs.map((p) => (
        <li key={p.pid} className="flex items-center gap-2 py-0.5 font-mono text-[10.5px] text-muted">
          <span className="w-10 shrink-0 text-faint tabular-nums">{p.pid}</span>
          <span className="min-w-0 flex-1 truncate" title={p.command}>{p.command}</span>
          <span className="shrink-0 tabular-nums">{formatCpu(p.cpu)}</span>
          <span className="w-12 shrink-0 text-right tabular-nums">{formatMem(p.memKb)}</span>
          {service.kind !== "weft" && (
            <button type="button" disabled={busy === `pid:${p.pid}`} onClick={() => onKill(p.pid)} aria-label={`End process ${p.pid}`} className="shrink-0 rounded px-1 hover:bg-sunken hover:text-danger disabled:opacity-50">
              <Icon name="x" size={9} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
