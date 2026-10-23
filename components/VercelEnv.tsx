"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import VercelEnvRows from "./VercelEnvRows";
import { ENV_SHORT, envLine, pullText, pushAllText, pushText, toPull, toPush, type VercelBridge, type VercelEnvRow, type VercelEnvStatus } from "@/lib/vercel-view";

// A linked project's 🔐 secrets against its Vercel variables (electron/vercel-env.cjs), under its deploy in the ▲
// drawer. Push sends one vault value to Vercel inside Electron main after Touch ID; Pull brings plain Vercel variables
// the vault has no value for into it, and Live pull does that on Vercel's webhook (lib/vercel-hooks.ts). The board
// sees names only.
export default function VercelEnv({ folder, team, bridge, notify }: { folder: string; team: string | null; bridge: VercelBridge; notify: (err: unknown) => void }) {
  const [env, setEnv] = useState<VercelEnvStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Whether this folder's team has a pull webhook; null until known, or when there's no Weft account to ask.
  const [liveOn, setLiveOn] = useState<boolean | null>(null);
  const status = bridge.envStatus;
  const isTeam = Boolean(team?.startsWith("team_"));

  const load = useCallback(() => {
    if (!status) return Promise.resolve();
    return status(folder).then(
      (s) => {
        setEnv(s);
        setError(null);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, [status, folder]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isTeam || !bridge.envPull) return;
    api.vercelHooks().then(
      (h) => setLiveOn(h.signedIn ? h.teams.includes(team as string) : null),
      () => setLiveOn(null),
    );
  }, [isTeam, team, bridge.envPull]);

  if (!status || !bridge.envPush) return <p className="text-faint">Restart Weft to push 🔐 secrets to Vercel</p>;
  if (error) return <p className="text-danger">Secrets: {error}</p>;
  if (!env) return <p className="text-faint">Secrets: checking…</p>;

  const push = bridge.envPush;
  const pull = bridge.envPull;
  const pushAll = bridge.envPushAll;
  // Opens by itself when there's something to push or pull, until you toggle it.
  const shown = open ?? (toPush(env.rows).length > 0 || toPull(env.rows).length > 0);

  async function bringDown() {
    if (!pull) return;
    setBusy("pull");
    try {
      notify(pullText(await pull(folder)));
      await load();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(null);
    }
  }

  async function toggleLive() {
    setBusy("live");
    try {
      if (liveOn) {
        await api.removeVercelHook(folder);
        setLiveOn(false);
        notify("Live pull is off: pull new Vercel variables by hand");
      } else {
        await api.addVercelHook(folder);
        setLiveOn(true);
        notify("Live pull is on: new plain Vercel variables come into the vault as they're added");
        await load();
      }
    } catch (err) {
      notify(err);
    } finally {
      setBusy(null);
    }
  }

  async function sendAll() {
    if (!pushAll) return;
    setBusy("all");
    try {
      notify(pushAllText(await pushAll(folder)));
      await load();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(null);
    }
  }

  async function send(row: VercelEnvRow) {
    const key = `${row.environment}\n${row.name}`;
    setBusy(key);
    try {
      notify(pushText(row.name, row.environment, await push(folder, row.name, row.environment)));
      await load();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <EnvHeader rows={env.rows} shown={shown} onToggle={() => setOpen(!shown)} busy={busy} onPushAll={pushAll ? () => void sendAll() : undefined} />
      {shown && (
        <VercelEnvRows
          rows={env.rows}
          footer={
            pull && isTeam && liveOn !== null && (
              <li className="flex items-center gap-1.5 pt-0.5">
                <span className="min-w-0 flex-1 truncate text-faint" title="A Vercel team webhook, relayed by your Weft account, pulls plain variables as they're added">
                  Live pull from Vercel
                </span>
                <button onClick={() => void toggleLive()} disabled={busy === "live"} role="switch" aria-checked={liveOn} className="text-[10px] text-faint hover:text-ink disabled:opacity-40">
                  {busy === "live" ? "…" : liveOn ? "on" : "off"}
                </button>
              </li>
            )
          }
        >
          {(rows) => rows.map((r) => (
            <li key={`${r.environment}\n${r.name}`} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink" title={r.name}>
                {r.name}
              </span>
              <span className="text-[10px] text-faint">{ENV_SHORT[r.environment]}</span>
              <RowAction row={r} busy={busy === `${r.environment}\n${r.name}` || (r.pullable === true && busy === "pull")} onPush={() => void send(r)} onPull={pull ? () => void bringDown() : undefined} />
            </li>
          ))}
        </VercelEnvRows>
      )}
    </div>
  );
}

// The 🔐 summary line that opens the list, with Push all beside it when the vault has anything to send.
function EnvHeader({ rows, shown, onToggle, busy, onPushAll }: { rows: VercelEnvRow[]; shown: boolean; onToggle: () => void; busy: string | null; onPushAll?: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-ink" aria-expanded={shown}>
        <span aria-hidden>🔐</span>
        <span className="min-w-0 flex-1 truncate">{envLine(rows)}</span>
        <span aria-hidden className="text-faint">
          {shown ? "▾" : "▸"}
        </span>
      </button>
      {onPushAll && rows.some((r) => r.inVault) && (
        <button onClick={onPushAll} disabled={busy !== null} className="shrink-0 rounded border border-line px-1.5 text-[10px] leading-[16px] text-faint hover:text-ink disabled:opacity-40" title="Send every vault value to Vercel, replacing what it has (one Touch ID)">
          {busy === "all" ? "Pushing…" : "Push all"}
        </button>
      )}
    </div>
  );
}

function RowAction({ row, busy, onPush, onPull }: { row: VercelEnvRow; busy: boolean; onPush: () => void; onPull?: () => void }) {
  if (!row.inVault && row.pullable && onPull)
    return (
      <button onClick={onPull} disabled={busy} className="text-[10px] text-faint hover:text-ink disabled:opacity-40" title="Bring Vercel's value into the vault (every plain one it has no value for)">
        {busy ? "Pulling…" : "Vercel only · pull"}
      </button>
    );
  if (!row.inVault) return <span className="text-[10px] text-faint">{row.onVercel ? "Vercel only" : "no value"}</span>;
  if (row.onVercel)
    return (
      <button onClick={onPush} disabled={busy} className="text-[10px] text-faint hover:text-ink disabled:opacity-40" title="Replace Vercel's value with the vault's (Touch ID)">
        {busy ? "Pushing…" : "on Vercel · push again"}
      </button>
    );
  return (
    <button onClick={onPush} disabled={busy} className="rounded bg-accent px-1.5 text-[10px] leading-[16px] font-medium text-on-accent disabled:opacity-40" title="Send the vault's value to Vercel (Touch ID)">
      {busy ? "Pushing…" : "Push"}
    </button>
  );
}
