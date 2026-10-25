"use client";

import { useState } from "react";
import { driftOf, missingPairs } from "@/lib/vercel-drift";
import { pullText, pushAllText, type VercelBridge, type VercelEnvRow } from "@/lib/vercel-view";

const BUTTON = "shrink-0 rounded border border-line px-1.5 text-[10px] leading-[16px] text-faint hover:text-ink disabled:opacity-40";

// The drift's answers beside a 🔐/▲ summary line (lib/vercel-drift.ts): Pull brings the plain Vercel variables the
// vault has no value for into it (electron/vercel-env.cjs pull, no Touch ID: it writes only into your vault), and
// Push sends just the vault values Vercel lacks, behind one Touch ID (pushAll with only). Nothing when in step.
export default function VercelDriftActions({ folder, rows, bridge, notify, onDone }: { folder: string; rows: VercelEnvRow[]; bridge: VercelBridge; notify: (msg: unknown) => void; onDone: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const s = driftOf(rows);
  const missing = missingPairs(rows);
  const pull = bridge.envPull;
  const pushAll = bridge.envPushAll;

  async function run(kind: "pull" | "push", act: () => Promise<string>) {
    setBusy(kind);
    try {
      notify(await act());
      await onDone();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {pull && s.pullable.length > 0 && (
        <button onClick={() => void run("pull", async () => pullText(await pull(folder)))} disabled={busy !== null} className={BUTTON} title={`Bring ${s.pullable.join(", ")} from Vercel into the vault`}>
          {busy === "pull" ? "Pulling…" : "Pull"}
        </button>
      )}
      {pushAll && missing.length > 0 && (
        <button
          onClick={() => void run("push", async () => pushAllText(await pushAll(folder, missing)))}
          disabled={busy !== null}
          className={BUTTON}
          title={`Send the ${missing.length} vault ${missing.length === 1 ? "value" : "values"} Vercel lacks (one Touch ID)`}
        >
          {busy === "push" ? "Pushing…" : `Push ${missing.length}`}
        </button>
      )}
    </>
  );
}
