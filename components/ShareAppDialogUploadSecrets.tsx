"use client";

import { useState } from "react";
import { readNeeds } from "@/lib/app-read-needs";
import type { AppPolicy } from "@/lib/app-share-types";
import { errorText } from "./ShareParts";

// "Upload secrets" appears when the manifest declares author secrets (no `from` or `from: "author"`),
// public names, or named reads (which need the author's keys on weft.zip, lib/app-read-needs.ts). Calling window.weft.appSecrets.push(appId) ships the named vault values to the cloud;
// Electron's preload wires the IPC, the dialog only handles the answer. A future agent will add the
// API; this button only renders and calls it when it's there. Split out from ShareAppDialog.tsx so the
// dialog stays under the 300-line cap (SOUL.md's ratchet).
export function UploadSecretsButton({ manifest, appId }: { manifest: AppPolicy | null; appId: string }) {
  // Hooks always run in the same order: useState is unconditional, then a guard decides whether to
  // render. The guard can't go above useState (it'd conditionally run hooks).
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  // The preload wires window.weft.appSecrets.push(appId) → IPC → the cloud; we call through the object
  // (not a captured reference) so the method's `this` stays bound. A button on the row needs the IPC.
  const secretsApi = typeof window !== "undefined" ? window.weft?.appSecrets : undefined;
  if (!hasUploabableSecrets(manifest)) return null;
  const upload = async () => {
    if (!secretsApi?.push) return;
    setBusy(true);
    setAnswer(null);
    try {
      const result = await secretsApi.push(appId);
      setAnswer(formatPushAnswer(result));
    } catch (err) {
      setAnswer(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 flex items-center gap-2 text-[12px]">
      <button type="button" onClick={() => void upload()} disabled={busy || !secretsApi?.push} className="rounded-md border border-line-strong px-2.5 py-1 text-ink hover:bg-sunken disabled:opacity-50">
        {busy ? "Uploading…" : "Upload secrets"}
      </button>
      {answer && <span className={isErrorAnswer(answer) ? "text-danger" : "text-muted"}>{answer}</span>}
    </div>
  );
}

function hasUploabableSecrets(manifest: AppPolicy | null): boolean {
  const secretRules = manifest?.secrets ?? {};
  const hasAuthorSecrets = Object.values(secretRules).some((r) => !r.from || r.from === "author");
  const hasPublic = (manifest?.public ?? []).length > 0;
  // Named reads run on weft.zip with the author's keys too (SUPABASE_SECRET_KEY, the GA4 pair).
  return hasAuthorSecrets || hasPublic || readNeeds(manifest).length > 0;
}

function formatPushAnswer(result: PushResult): string {
  if ("error" in result) return result.error;
  return result.pushed.length ? `Uploaded ${result.pushed.join(", ")}` : "Nothing to upload.";
}

function isErrorAnswer(answer: string): boolean {
  return answer !== "Nothing to upload." && !answer.startsWith("Uploaded");
}

type PushResult = { ok: true; pushed: string[] } | { error: string };
