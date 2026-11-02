"use client";

import { useState } from "react";
import { STATE_TONE } from "@/lib/services-view";
import type { ServiceState } from "@/lib/types";
import { openWorkerDev, restartWorkerDev, stopWorkerDev, workerDevLog } from "@/lib/worker-dev-acts";
import type { WorkerDevGroup } from "@/lib/worker-dev-list";
import { shownWorkerDev } from "@/lib/worker-dev-view";

type Props = {
  groups: WorkerDevGroup[];
  // The top bar's project, or null for every project: a worker project shows its own checkout's servers, a project on
  // this Mac the servers in a worker's checkout of the same name (lib/worker-dev-view.ts).
  project: string | null;
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
  open?: typeof openWorkerDev;
  stop?: typeof stopWorkerDev;
  restart?: typeof restartWorkerDev;
  readLog?: typeof workerDevLog;
};

const BUTTON = "shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-panel hover:text-ink disabled:opacity-50";
const tone = (state: string) => (state in STATE_TONE ? STATE_TONE[state as ServiceState] : STATE_TONE.stopped);

// The Services drawer's section for your Weft Workers' dev servers (docs/architecture/dev-servers.md#on-a-worker), one
// small group per worker. The pane can't reach a worker's localhost, so Open gives the server a private address (a
// tunnel, after your Touch ID) and opens that in the pane; a server with one open already opens straight away. A run
// Weft started also has Log, which reads its last lines from the worker into the row, Restart (Start once it ended)
// and Stop.
export default function WorkerDevServers({ groups, project, onOpenUrl, notify, open = openWorkerDev, stop = stopWorkerDev, restart = restartWorkerDev, readLog = workerDevLog }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string>>({});
  const shown = shownWorkerDev(groups, project);
  if (!shown.length) return null;
  const run = (key: string, work: () => Promise<void>) => () => {
    setBusy(key);
    void work()
      .catch(notify)
      .finally(() => setBusy(null));
  };
  // Log toggles: a second click hides it, and opening it again reads it afresh.
  const toggleLog = (key: string, cardId: string) =>
    key in logs
      ? () => setLogs((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key)))
      : run(key, async () => {
          const text = await readLog(cardId);
          setLogs((all) => ({ ...all, [key]: text }));
        });
  return (
    <section aria-label="Worker dev servers" className="border-b border-line px-1.5 pb-1.5">
      {shown.map((g) => (
        <div key={g.workerId}>
          <h3 className="px-2 pt-1 pb-0.5 text-[10.5px] font-medium tracking-wide text-faint uppercase">On {g.worker}</h3>
          <ul className="flex flex-col gap-px">
            {g.servers.map((s) => {
              const key = `${g.workerId}:${s.cardId}`;
              const weft = s.source === "weft";
              const ended = s.state === "stopped" || s.state === "failed";
              return (
                <li key={key} className="rounded-md px-2 py-1 text-[12px] hover:bg-sunken">
                  <div className="flex items-center gap-2">
                    <span className={`size-1.5 shrink-0 rounded-full ${tone(s.state)}`} title={s.state} />
                    <span className="shrink-0 text-ink">{s.folder}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={s.command}>
                      {s.command}
                    </span>
                    {s.url && (
                      <button
                        type="button"
                        disabled={busy === key}
                        onClick={run(key, async () => onOpenUrl(s.address ?? (await open(s.cardId))))}
                        className={BUTTON}
                        title={s.address ? `Open ${s.address} in the browser pane` : `Give ${s.url} a private address (Touch ID) and open it`}
                      >
                        {busy === key ? "…" : "Open"}
                      </button>
                    )}
                    {weft && (
                      <button type="button" disabled={busy === key} onClick={toggleLog(key, s.cardId)} aria-pressed={key in logs} className={BUTTON} title="The server's last lines, from the worker">
                        Log
                      </button>
                    )}
                    {weft && (
                      <button type="button" disabled={busy === key} onClick={run(key, () => restart(s.cardId))} className={BUTTON}>
                        {ended ? "Start" : "Restart"}
                      </button>
                    )}
                    {weft && s.state !== "stopped" && (
                      <button type="button" disabled={busy === key} onClick={run(key, () => stop(s.cardId))} className={`${BUTTON} hover:text-danger`}>
                        Stop
                      </button>
                    )}
                  </div>
                  {key in logs && <pre className="mt-1 max-h-40 overflow-auto rounded bg-canvas px-2 py-1 font-mono text-[10.5px] whitespace-pre-wrap text-muted">{logs[key]}</pre>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
