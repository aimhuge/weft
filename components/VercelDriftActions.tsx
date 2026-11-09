"use client";

import { useState } from "react";
import { driftOf, missingPairs, pullPlan } from "@/lib/vercel-drift";
import VercelPullPreview from "./VercelPullPreview";
import { pullText, pushAllText, type VercelBridge, type VercelEnvRow } from "@/lib/vercel-view";

const BUTTON = "shrink-0 rounded border border-line px-1.5 text-[10px] leading-[16px] text-faint hover:text-ink disabled:opacity-40";

// The drift's answers beside a 🔐/▲ summary line (lib/vercel-drift.ts): Pull opens a preview of what's on Vercel and
// not in the vault, by environment (components/VercelPullPreview.tsx), then brings the ones Vercel hands back into it
// behind one Touch ID (electron/vercel-env.cjs pull; sensitive ones are listed to add by hand), and
// Push sends just the vault values Vercel lacks, behind one Touch ID (pushAll with only). Nothing when in step.
export default function VercelDriftActions({ folder, rows, bridge, notify, onDone }: { folder: string; rows: VercelEnvRow[]; bridge: VercelBridge; notify: (msg: unknown) => void; onDone: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [preview, setPreview] = useState(false);
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
      {pull && s.notInVault.length > 0 && (
        <span className="relative shrink-0">
          <button onClick={() => setPreview((v) => !v)} disabled={busy !== null} aria-expanded={preview} className={BUTTON} title={`${s.notInVault.length} on Vercel not in the vault: see what Pull can bring down`}>
            {busy === "pull" ? "Pulling…" : "Pull"}
          </button>
          {preview && (
            <VercelPullPreview
              plan={pullPlan(rows)}
              onClose={() => setPreview(false)}
              onPull={() => {
                setPreview(false);
                void run("pull", async () => pullText(await pull(folder)));
              }}
            />
          )}
        </span>
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
