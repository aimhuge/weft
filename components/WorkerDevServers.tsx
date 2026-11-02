"use client";

import { useState } from "react";
import { STATE_TONE } from "@/lib/services-view";
import type { ServiceState } from "@/lib/types";
import { openWorkerDev, stopWorkerDev } from "@/lib/worker-dev-acts";
import type { WorkerDevGroup } from "@/lib/worker-dev-list";

type Props = {
  groups: WorkerDevGroup[];
  // The top bar's project, or null for every project: a worker's server is shown under its folder's name.
  project: string | null;
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
  open?: typeof openWorkerDev;
  stop?: typeof stopWorkerDev;
};

const BUTTON = "shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-panel hover:text-ink disabled:opacity-50";
const tone = (state: string) => (state in STATE_TONE ? STATE_TONE[state as ServiceState] : STATE_TONE.stopped);
const projectName = (project: string | null) => project?.split("/").filter(Boolean).pop()?.toLowerCase() ?? null;

// The Services drawer's section for your Weft Workers' dev servers (docs/architecture/dev-servers.md#on-a-worker), one
// small group per worker. The pane can't reach a worker's localhost, so Open gives the server a private address (a
// tunnel, after your Touch ID) and opens that in the pane; a server with one open already opens straight away.
export default function WorkerDevServers({ groups, project, onOpenUrl, notify, open = openWorkerDev, stop = stopWorkerDev }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const only = projectName(project);
  const shown = groups.map((g) => ({ ...g, servers: g.servers.filter((s) => !only || s.folder.toLowerCase() === only) })).filter((g) => g.servers.length);
  if (!shown.length) return null;
  const run = (key: string, work: () => Promise<void>) => () => {
    setBusy(key);
    void work()
      .catch(notify)
      .finally(() => setBusy(null));
  };
  return (
    <section aria-label="Worker dev servers" className="border-b border-line px-1.5 pb-1.5">
      {shown.map((g) => (
        <div key={g.workerId}>
          <h3 className="px-2 pt-1 pb-0.5 text-[10.5px] font-medium tracking-wide text-faint uppercase">On {g.worker}</h3>
          <ul className="flex flex-col gap-px">
            {g.servers.map((s) => {
              const key = `${g.workerId}:${s.cardId}`;
              return (
                <li key={key} className="flex items-center gap-2 rounded-md px-2 py-1 text-[12px] hover:bg-sunken">
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
                  {s.source === "weft" && s.state !== "stopped" && (
                    <button type="button" disabled={busy === key} onClick={run(key, () => stop(s.cardId))} className={`${BUTTON} hover:text-danger`}>
                      Stop
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
