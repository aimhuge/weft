"use client";

// The Settings → Sync page: which projects upload their cards to your workspace, the live status of
// the last flush, and a Sync now button. The same Roster pattern as the GitHub drawer (lib/use-github.ts)
// would also work, but the page is a Settings page, not a rail drawer, so it polls its own hook
// (lib/use-cloud-sync.ts). The list comes from the user's recent projects, the same list the new-thread
// dialog uses (lib/settings.ts listProjects); only projects the user can actually turn on are listed.

import { useState, type ReactNode } from "react";
import { timeAgo } from "@/lib/format";
import { useAccount } from "@/lib/use-account";
import { useCloudSync } from "@/lib/use-cloud-sync";
import { useNow } from "@/lib/use-now";
import { openTeamPage } from "./board-palette";
import PairDevices from "./PairDevices";
import PhoneSettings from "./PhoneSettings";
import WorkerSettings from "./WorkerSettings";
import Icon, { Spinner } from "./Icon";
import { folderName } from "./ProjectBar";
import SwitchRow from "./SwitchRow";

const CARD = "rounded-xl border border-line-strong bg-panel/85 p-5 shadow-lg backdrop-blur-xl";
const SECTION_TITLE = "mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint";
const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section data-settings-card className={CARD} onMouseDown={(e) => e.stopPropagation()}>
      {title ? <h4 className={SECTION_TITLE}>{title}</h4> : null}
      {children}
    </section>
  );
}

function StatusCard({ status, busy, onSyncNow, error, syncError, now }: { status: { waiting: number; lastSyncAt: number | null; uploaded: number; lastError: string | null; signedOut: boolean; noWorkspace: boolean }; busy: boolean; onSyncNow: () => void; error: string | null; syncError: string | null; now: number }) {
  const headline = status.signedOut
    ? "Sign in to Weft to sync"
    : status.noWorkspace
      ? "Open the web board to claim your workspace"
      : status.lastError
        ? "Last sync failed"
        : status.lastSyncAt
          ? `Last sync ${timeAgo(status.lastSyncAt, now)}`
          : "Not synced yet";
  return (
    <Section title="Status">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink">{headline}</span>
          <button type="button" onClick={onSyncNow} disabled={busy} className={`flex items-center gap-1.5 ${BUTTON}`}>
            {busy && <Spinner size={11} />}
            <Icon name="reload" size={12} /> Sync now
          </button>
        </div>
        <p className={SUBTLE}>
          {status.uploaded} item{status.uploaded === 1 ? "" : "s"} uploaded · {status.waiting} waiting
        </p>
        {status.lastError && <p className="text-[12.5px] text-danger">Last error: {status.lastError}</p>}
        {error && <p className="text-[12.5px] text-danger">Couldn&apos;t reach the server: {error}</p>}
        {syncError && <p className="text-[12.5px] text-danger">Couldn&apos;t sync: {syncError}</p>}
      </div>
    </Section>
  );
}

function ProjectsCard({ folders, synced, busy, error, onToggle }: { folders: string[]; synced: string[]; busy: boolean; error: string | null; onToggle: (folder: string, on: boolean) => void }) {
  // Only the user's recent projects are listed; the server resolves and 400s anything else.
  return (
    <Section title="Projects">
      <p className={`mb-3 ${SUBTLE}`}>
        Thread text is uploaded unencrypted unless Seal synced threads (below, under Pair a phone) is on.
      </p>
      {folders.length === 0 ? (
        <p className={SUBTLE}>
          No recent projects yet. Start a card and the folder shows up here; turn the switch on to upload its cards to your workspace.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {folders.map((folder) => (
            <li key={folder}>
              <SwitchRow
                title={folderName(folder)}
                hint={folder}
                on={synced.includes(folder)}
                onChange={(on) => onToggle(folder, on)}
              />
            </li>
          ))}
        </ul>
      )}
      {busy && (
        <p className={`mt-3 flex items-center gap-2 ${SUBTLE}`}>
          <Spinner size={11} /> Saving
        </p>
      )}
      {error && <p className="mt-3 text-[12.5px] text-danger">Couldn&apos;t save that: {error}</p>}
    </Section>
  );
}

function SignedOutCard() {
  return (
    <Section title="Sign in to Weft">
      <p className="text-[13px] text-ink">Cloud sync uploads your cards to your Weft workspace so they show up on the web too.</p>
      <p className={`mt-2 ${SUBTLE}`}>
        Sign in from the Accounts page. Once you have, this page lists your projects and how the last sync went.
      </p>
    </Section>
  );
}

function NoWorkspaceCard() {
  return (
    <Section title="No workspace yet">
      <p className="text-[13px] text-ink">Your Weft account is signed in, but you don&apos;t have a workspace yet.</p>
      <p className={`mt-2 ${SUBTLE}`}>
        Open the web board once to create yours. After that, your projects appear here and you can turn sync on.
      </p>
      <div className="mt-3">
        <button type="button" onClick={openTeamPage} className={BUTTON}>
          Open the web board
        </button>
      </div>
    </Section>
  );
}

export default function SyncSettings({ recentProjects }: { recentProjects: string[] }) {
  // The Sync page polls while open so a slow upload shows up; the dialog remounts on close.
  const { state: accountState } = useAccount();
  const signedIn = accountState.kind === "ready" && !!accountState.view.user;
  const signedOut = accountState.kind === "ready" && !accountState.view.user;
  const { folders, status, error, setFolder, syncNow } = useCloudSync(true);
  // useNow ticks once a second so "Last sync" reads stay fresh; Date.now() during render is impure.
  const now = useNow();
  const [busy, setBusy] = useState<"sync" | "folder" | null>(null);
  // A toggle or Sync now that failed (the server restarting, a folder it refused), shown by the card it came from.
  const [failed, setFailed] = useState<{ folder?: string; sync?: string }>({});

  // The server only knows the opt-in folders; the page shows the user's recent projects so a folder
  // can be turned on before it ships a card.
  const listed = Array.from(new Set([...folders, ...recentProjects])).sort((a, b) => a.localeCompare(b));

  async function onToggle(folder: string, on: boolean) {
    setBusy("folder");
    setFailed((f) => ({ ...f, folder: undefined }));
    try {
      await setFolder(folder, on);
    } catch (err) {
      setFailed((f) => ({ ...f, folder: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function onSyncNow() {
    setBusy("sync");
    setFailed((f) => ({ ...f, sync: undefined }));
    try {
      await syncNow();
    } catch (err) {
      setFailed((f) => ({ ...f, sync: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {signedOut ? (
        <SignedOutCard />
      ) : status.noWorkspace && signedIn ? (
        <NoWorkspaceCard />
      ) : (
        <StatusCard status={status} busy={busy === "sync"} onSyncNow={() => void onSyncNow()} error={error} syncError={failed.sync ?? null} now={now} />
      )}
      <ProjectsCard folders={listed} synced={folders} busy={busy === "folder"} error={failed.folder ?? null} onToggle={(folder, on) => void onToggle(folder, on)} />
      {signedIn && <PhoneSettings />}
      {signedIn && <PairDevices />}
      {signedIn && <WorkerSettings />}
      <Section>
        <p className={SUBTLE}>
          Cards, thread items and long tool results go to your Weft workspace on weft.zip, and pictures and pages once each by content. Open the
          web board there to watch them arrive.
        </p>
        <div className="mt-3">
          <button type="button" onClick={openTeamPage} className={BUTTON}>
            Open the web board
          </button>
        </div>
      </Section>
    </>
  );
}
