"use client";

import { useState } from "react";
import type { useCloudSync } from "@/lib/use-cloud-sync";
import { useNow } from "@/lib/use-now";
import type { CloudSyncStatus } from "@/lib/cloud-sync-view";
import { syncDot, syncLine, type SyncTone } from "@/lib/sync-menu";
import { openTeamPage } from "./board-palette";
import Icon, { Spinner, type IconName } from "./Icon";
import { folderName } from "./ProjectBar";

export const TONE_DOT: Record<SyncTone, string> = { ok: "bg-ok", busy: "bg-accent", error: "bg-danger", off: "bg-faint" };

// The dot on the avatar (components/AccountButton.tsx): amber while an upload is under way, red when one failed, else nothing.
export function SyncDot({ status, folders }: { status: CloudSyncStatus; folders: string[] }) {
  const dot = syncDot(status, folders);
  if (!dot) return null;
  return (
    <span
      role="status"
      aria-label={dot === "error" ? "Board sync failed" : "Board syncing"}
      className={`absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-panel ${TONE_DOT[dot]} ${dot === "busy" ? "animate-pulse" : ""}`}
    />
  );
}

// The avatar menu's Sync section (components/AccountMenu.tsx): how board sync to weft.zip is going, Resync now, and
// Sync / Don't sync for the board's project. Its items keep the menu open, so the line above them shows the answer.
// The whole page, with a switch per project, is Settings → Sync (components/SyncSettings.tsx).
export default function AccountSync({ sync, project }: { sync: ReturnType<typeof useCloudSync>; project: string | null }) {
  const now = useNow();
  const [busy, setBusy] = useState<"sync" | "project" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { status, folders } = sync;
  const line = syncLine(status, folders, now);
  const synced = !!project && folders.includes(project);

  const attempt = async (kind: "sync" | "project", act: () => Promise<void>) => {
    setBusy(kind);
    setFailed(null);
    try {
      await act();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const run = (kind: "sync" | "project", act: () => Promise<void>) => () => void attempt(kind, act);

  return (
    <div className="mb-1 border-b border-line pb-1">
      <div className="px-2.5 pb-1 pt-1.5">
        <span className="flex items-center gap-2 text-[13px] text-ink">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE_DOT[line.tone]}`} />
          {line.text}
        </span>
        {line.sub && (
          <span title={line.sub} className={`block truncate pl-4 text-[11.5px] ${line.tone === "error" ? "text-danger" : "text-muted"}`}>
            {line.sub}
          </span>
        )}
        {failed && <span className="block pl-4 text-[11.5px] text-danger">Couldn&apos;t: {failed}</span>}
      </div>
      {status.signedOut ? null : status.noWorkspace ? (
        <SyncItem icon="globe" label="Open the web board" onClick={openTeamPage} />
      ) : (
        <>
          {folders.length > 0 && <SyncItem icon="reload" label="Resync now" busy={busy === "sync"} onClick={run("sync", sync.syncNow)} />}
          {project && (
            <SyncItem
              icon={synced ? "x" : "check"}
              label={synced ? `Don't sync ${folderName(project)}` : `Sync ${folderName(project)}`}
              sub={synced ? undefined : "Uploads its threads, unencrypted for now"}
              busy={busy === "project"}
              onClick={run("project", () => sync.setFolder(project, !synced))}
            />
          )}
        </>
      )}
    </div>
  );
}

function SyncItem({ icon, label, sub, busy, onClick }: { icon: IconName; label: string; sub?: string; busy?: boolean; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} disabled={busy} className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-sunken disabled:opacity-60">
      <span className="flex w-full items-center gap-2 text-[13px] text-ink">
        {busy ? <Spinner size={14} /> : <Icon name={icon} size={14} className="text-muted" />}
        <span className="truncate">{label}</span>
      </span>
      {sub && <span className="pl-6 text-[11.5px] leading-snug text-muted">{sub}</span>}
    </button>
  );
}
