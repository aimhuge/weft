"use client";

import { useCallback, useEffect, useState } from "react";
import VercelDriftActions from "./VercelDriftActions";
import { driftLine } from "@/lib/vercel-drift";
import { envLine, vercelBridge, type VercelEnvStatus } from "@/lib/vercel-view";

// A vault's ▲ line in the 🔐 drawer: when its folder is linked to a Vercel project (the ▲ drawer, .vercel/project.json),
// how its values stand on Vercel. When the two drift apart it says so ("4 on Vercel not in vault: pull?", "2 missing
// on preview: push?", lib/vercel-drift.ts) with Pull and Push beside it (components/VercelDriftActions.tsx).
// An unlinked folder, no Vercel sign-in or an older main draw nothing. changed reloads it after the vault changes.
export default function VaultVercel({ folder, changed, notify }: { folder: string; changed: string; notify: (err: unknown) => void }) {
  const bridge = vercelBridge();
  const status = bridge?.envStatus;
  const [env, setEnv] = useState<VercelEnvStatus | null>(null);

  const load = useCallback(() => {
    if (!status) return Promise.resolve();
    return status(folder).then(setEnv, () => setEnv(null));
  }, [status, folder]);

  useEffect(() => {
    void load();
  }, [load, changed]);

  if (!bridge || !env || !env.rows.length) return null;

  return (
    <div className="mx-1 mt-1 flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] text-muted">
      <span className="min-w-0 flex-1 truncate" title={`Linked to the Vercel project ${env.project}`}>
        <span aria-hidden>▲ </span>
        <span className="text-ink">{env.project}</span> · {driftLine(env.rows) ?? envLine(env.rows)}
      </span>
      <VercelDriftActions folder={folder} rows={env.rows} bridge={bridge} notify={notify} onDone={load} />
    </div>
  );
}
