"use client";

import { useCallback, useEffect, useState } from "react";
import { envLine, pushAllText, toPush, vercelBridge, type VercelEnvStatus } from "@/lib/vercel-view";

// A vault's ▲ line in the 🔐 drawer: when its folder is linked to a Vercel project (the ▲ drawer, .vercel/project.json),
// how its values stand on Vercel and, when some aren't there yet, Push all (one Touch ID, electron/vercel-env.cjs).
// An unlinked folder, no Vercel sign-in or an older main draw nothing. changed reloads it after the vault changes.
export default function VaultVercel({ folder, changed, notify }: { folder: string; changed: string; notify: (err: unknown) => void }) {
  const bridge = vercelBridge();
  const status = bridge?.envStatus;
  const pushAll = bridge?.envPushAll;
  const [env, setEnv] = useState<VercelEnvStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!status) return Promise.resolve();
    return status(folder).then(setEnv, () => setEnv(null));
  }, [status, folder]);

  useEffect(() => {
    void load();
  }, [load, changed]);

  if (!env || !env.rows.some((r) => r.inVault)) return null;
  const left = toPush(env.rows).length;

  async function send() {
    if (!pushAll) return;
    setBusy(true);
    try {
      notify(pushAllText(await pushAll(folder)));
      await load();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-1 mt-1 flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] text-muted">
      <span className="min-w-0 flex-1 truncate" title={`Linked to the Vercel project ${env.project}`}>
        <span aria-hidden>▲ </span>
        <span className="text-ink">{env.project}</span> · {envLine(env.rows)}
      </span>
      {left > 0 && pushAll && (
        <button
          onClick={() => void send()}
          disabled={busy}
          className="shrink-0 rounded bg-accent px-1.5 text-[10px] leading-[16px] font-medium text-on-accent disabled:opacity-40"
          title={`Send this vault's values to ${env.project} on Vercel, replacing what it has (one Touch ID)`}
        >
          {busy ? "Pushing…" : "Push to Vercel"}
        </button>
      )}
    </div>
  );
}
