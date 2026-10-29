"use client";

// "Turn on Project Sync for <project>?": asked once a launch about the project you're working on, once one of its threads
// reaches Review, until you sync it or tick "Don't show me again" (lib/sync-prompt.ts, lib/use-sync-prompt.ts). Signed out,
// it is Weft's one sign-in ask: "Sign in to Weft?" with what an account gets you, and once you're in (the window's focus
// reads the status again) it turns into the sync ask. With no workspace yet, it opens the web board to make one. Syncing
// is the same switch as Settings → Sync.

import { useState } from "react";
import type { CloudSyncStatus } from "@/lib/cloud-sync-view";
import type { Card } from "@/lib/types";
import { useAccount } from "@/lib/use-account";
import { useSyncPrompt } from "@/lib/use-sync-prompt";
import { openTeamPage } from "./board-palette";
import Icon, { Spinner } from "./Icon";
import Modal from "./Modal";
import { folderName } from "./ProjectBar";

const PRIMARY = "inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50";
const SECONDARY = "rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken";

// What a Weft account adds, for the signed-out ask: the features that otherwise each ask on their own.
const PERKS = [
  { icon: "☁️", what: "Project Sync", how: "follow and steer its cards from your web dashboard" },
  { icon: "🔗", what: "Share links", how: "for a card, an app or the whole board" },
  { icon: "🏆", what: "Leagues", how: "rank with other builders by the XP you earn each week" },
  { icon: "🆓", what: "Puku trial", how: "run puku threads free, no Puku account needed" },
];

function SignInBody({ name }: { name: string }) {
  return (
    <>
      <p className="text-[13px] text-ink">
        <b>{name}</b> has a thread ready for review. Sign in with GitHub to take your work further:
      </p>
      <ul className="flex flex-col gap-1 text-[13px] text-ink">
        {PERKS.map((p) => (
          <li key={p.what}>
            {p.icon} <b>{p.what}</b>: {p.how}
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] text-muted">Weft works signed out too. Once you&apos;re in, this offers to sync {name}.</p>
    </>
  );
}

function SyncBody({ name, noWorkspace }: { name: string; noWorkspace: boolean }) {
  return (
    <>
      <p className="text-[13px] text-ink">
        Weft&apos;s Project Sync keeps <b>{name}</b>&apos;s cards on your web dashboard while they run on your computer, so you can
        manage your Weft from the web.
      </p>
      <p className="text-[13px] text-ink">
        Synced projects are especially great for teams: members can watch each other&apos;s work and even contribute in real time.
      </p>
      <p className="text-[12.5px] text-muted">
        {noWorkspace
          ? "Open the web board once to make your workspace, then come back to sync."
          : "Thread text is uploaded unencrypted for now. You can turn it off any time in Settings → Sync."}
      </p>
    </>
  );
}

function Prompt({ folder, status, onClose, onSync }: { folder: string; status: CloudSyncStatus | null; onClose: (neverAgain: boolean) => void; onSync: () => Promise<void> }) {
  const { state, signIn } = useAccount();
  const [never, setNever] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = folderName(folder);
  const signedOut = status?.signedOut || (state.kind === "ready" && !state.view.user);

  const sync = () => {
    setBusy(true);
    setError(null);
    onSync().catch((err: unknown) => {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    });
  };
  const action = signedOut
    ? { label: "Sign in with GitHub", run: () => void signIn("github") }
    : status?.noWorkspace
      ? { label: "Open the web board", run: openTeamPage }
      : { label: `Sync ${name}`, run: sync };

  return (
    <Modal title={signedOut ? "Sign in to Weft?" : `Turn on Project Sync for ${name}?`} onClose={() => onClose(never)} keepOnBackdrop className="w-full max-w-[440px]">
      <div className="flex flex-col gap-3 px-5 py-4">
        {signedOut ? <SignInBody name={name} /> : <SyncBody name={name} noWorkspace={Boolean(status?.noWorkspace)} />}
        {error && <p className="text-[12.5px] text-danger">Couldn&apos;t turn sync on: {error}</p>}
        <div className="mt-1 flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} className="accent-accent" />
            Don&apos;t show me again
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onClose(never)} className={SECONDARY}>
              Not now
            </button>
            <button type="button" onClick={action.run} disabled={busy} className={PRIMARY} autoFocus>
              {busy && <Spinner size={11} />}
              {!busy && signedOut && <Icon name="github" size={13} />}
              {action.label}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function SyncPromptDialog({ cwd, cards, toast }: { cwd?: string | null; cards: Card[]; toast: (text: string) => void }) {
  const { folder, status, close, syncIt } = useSyncPrompt(cwd, cards);
  if (!folder) return null;
  const onSync = () => syncIt(folder).then(() => toast(`${folderName(folder)} is syncing to your web dashboard.`));
  return <Prompt folder={folder} status={status} onClose={close} onSync={onSync} />;
}
