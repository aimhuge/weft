"use client";

// Settings → Devices → a paired worker's Secrets (docs/architecture/secrets.md#kept-on-a-worker): "Keep on this worker"
// for one project's development or preview secrets. Off by default, behind a warning the user has to tick: every card
// on a worker runs as the same OS user as the daemon, so code a thread runs there can read what's kept, whatever it's
// sealed with. Each use still asks Touch ID on this Mac; keeping only saves sending the value each time.
import { useState } from "react";
import type { DeviceView } from "@/lib/device-registry";
import { useWorkerKeep, type WorkerKeepBridge } from "@/lib/use-worker-keep";

const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";
const SELECT = "rounded-md border border-line-strong bg-transparent px-1.5 py-1 text-[12.5px] text-ink";

export function WorkerKeep({ device, onClose, bridge }: { device: Pick<DeviceView, "id" | "name">; onClose: () => void; bridge?: WorkerKeepBridge }) {
  const k = useWorkerKeep(device.id, device.name, bridge);
  const [repo, setRepo] = useState("");
  const [environment, setEnvironment] = useState("development");
  const [understood, setUnderstood] = useState(false);
  const repos = k.list?.repos ?? [];
  const chosen = repo || repos[0]?.id || "";
  if (!k.available) return null;
  return (
    <div className="mt-2 flex w-full flex-col gap-2">
      <p className="text-[12.5px] text-warn">
        Keeping secrets on {device.name} stores them on its disk, sealed to its key. Every thread on that worker runs as the same user, so code a thread runs there can read
        them. Each use still asks you here. Production values never stay there.
      </p>
      {k.list?.kept.length ? (
        <ul className="flex flex-col gap-1">
          {k.list.kept.map((e) => (
            <li key={`${e.repo} ${e.environment}`} className="flex items-center justify-between gap-2 text-[12.5px] text-ink">
              <span className="min-w-0 truncate" title={e.names.join(", ")}>
                {e.label} · {e.environment} · {e.names.length === 1 ? "1 secret" : `${e.names.length} secrets`}
              </span>
              <button type="button" className={BUTTON} disabled={k.busy} onClick={() => void k.stop(e.repo, e.environment)} aria-label={`Stop keeping ${e.label} ${e.environment} on ${device.name}`}>
                Stop
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted">Nothing kept on {device.name}: every secret travels per use.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Project" className={SELECT} value={chosen} onChange={(e) => setRepo(e.target.value)}>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select aria-label="Environment" className={SELECT} value={environment} onChange={(e) => setEnvironment(e.target.value)}>
          {(k.list?.environments ?? ["development", "preview"]).map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-start gap-2 text-[12.5px] text-ink">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        <span>I understand any code a thread runs on {device.name} can read these values.</span>
      </label>
      {k.note && <p className="text-[12.5px] text-ink">{k.note}</p>}
      {k.error && <p className="text-[12.5px] text-danger">{k.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={k.busy || !understood || !chosen} onClick={() => void k.keep(chosen, environment)}>
          Keep on this worker
        </button>
        <button type="button" className={BUTTON} disabled={k.busy} onClick={() => void k.wipe()} title="Tell the worker to delete everything this Mac kept there">
          Wipe all
        </button>
        <button type="button" className={BUTTON} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
