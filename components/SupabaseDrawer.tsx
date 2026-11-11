"use client";

import { useState } from "react";
import { folderName } from "@/lib/format";
import type { Card } from "@/lib/types";
import {
  needsRestart,
  shownFolders,
  signedInLine,
  TOKEN_URL,
  type SupabaseBridge,
  type SupabaseFolder,
  type SupabaseOrg,
  type SupabaseProject,
  type SupabaseStatus,
} from "@/lib/supabase-view";
import SupabaseLinked from "./SupabaseLinked";
import SupabasePicker from "./SupabasePicker";
import { FolderRow } from "./FolderRow";
import { SMALL } from "./tone";
import { TokenForm } from "./TokenForm";
import { Note } from "./VaultParts";
import { VaultTokenOffer } from "./VaultTokenOffer";

// The Supabase drawer's body (docs/architecture/supabase.md): your Supabase access token, kept by Electron main
// in the Keychain, and each board project's link to a Supabase project, written as supabase/.temp/project-ref
// so the Supabase CLI in a thread works on the right project. The drawer shows the top bar's project, or all.
export default function SupabaseDrawer({
  bridge,
  status,
  error,
  reload,
  project,
  cards,
  onOpenCard,
  onStart,
  onOpenUrl,
  notify,
}: {
  bridge: SupabaseBridge | null;
  status: SupabaseStatus | null;
  error: string | null;
  reload: () => Promise<void>;
  project: string | null;
  // The board's cards, to link an unapplied migration to the card that wrote it, and opening one.
  cards: Card[];
  onOpenCard: (card: Card) => void;
  // Starts a card in a folder (the Migrate card); rejects when that fails.
  onStart: (cwd: string, prompt: string, title: string) => Promise<string | undefined>;
  // Shows a page in the board's browser pane.
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [projects, setProjects] = useState<SupabaseProject[] | null>(null);
  const [orgs, setOrgs] = useState<SupabaseOrg[] | null>(null);

  const shell = typeof window !== "undefined" ? window.weft : undefined;
  if (needsRestart(Boolean(shell), bridge, error)) return <Restart />;
  if (!bridge) return <Note>Supabase links live in Weft&apos;s desktop app, where Electron keeps your token in the Keychain.</Note>;
  if (error) return <Note>{error}</Note>;
  if (!status) return <Note>Asking Supabase…</Note>;

  const supabase = bridge;

  async function change(run: () => Promise<unknown>) {
    setBusy(true);
    try {
      await run();
      await reload();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  }

  if (!status.signedIn || status.error)
    return (
      <div className="flex flex-col">
        <TokenForm
          error={status.error}
          busy={busy}
          provider="Supabase"
          tokenUrl={TOKEN_URL}
          placeholder="sbp_…"
          label="Supabase access token"
          onSave={(token) =>
            change(async () => {
              const { orgs } = await supabase.setToken(token);
              setProjects(null);
              setOrgs(null);
              notify(`Signed in to Supabase${orgs.length ? ` (${orgs.join(", ")})` : ""}`);
            })
          }
          onForget={status.signedIn ? () => void change(() => supabase.forgetToken()) : undefined}
        />
        <VaultTokenOffer
          source={supabase}
          folders={status.folders.map((f) => f.folder)}
          busy={busy}
          onUse={(pick) =>
            change(async () => {
              const r = await supabase.useVaultToken?.(pick);
              if (!r) return;
              if (!("status" in r)) {
                notify("denied" in r ? "Touch ID said no, so nothing changed." : "That vault no longer has the value.");
                return;
              }
              const { orgs } = r.status;
              setProjects(null);
              setOrgs(null);
              notify(`Signed in to Supabase${orgs.length ? ` (${orgs.join(", ")})` : ""}`);
            })
          }
        />
      </div>
    );

  async function startPicking(folder: string) {
    setPicking(folder);
    if (projects && orgs) return;
    try {
      // No orgs (a Weft started before New project, or Supabase failing) leaves Link… working and New project saying why.
      const [list, known] = await Promise.all([supabase.projects(), supabase.orgs().catch(() => [])]);
      setProjects(list);
      setOrgs(known);
    } catch (err) {
      setPicking(null);
      notify(err);
    }
  }

  const shown = shownFolders(status.folders, project);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate" title={status.orgs?.join(", ")}>
          {signedInLine(status.orgs)}
        </span>
        <button onClick={() => void change(() => supabase.forgetToken())} disabled={busy} className={SMALL} title="Forget the token kept in the Keychain">
          Sign out
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && <Note>Add a project to the board to link it to Supabase.</Note>}
        {shown.map((f) =>
          picking === f.folder ? (
            <SupabasePicker
              key={f.folder}
              folder={f}
              projects={projects}
              orgs={orgs}
              busy={busy}
              onPick={(p) =>
                change(async () => {
                  const { name } = await supabase.link(f.folder, p.ref);
                  setPicking(null);
                  notify(`Linked ${folderName(f.folder)} to ${name} on Supabase`);
                })
              }
              onCreate={(p) =>
                change(async () => {
                  const { name, secret } = await supabase.create(f.folder, p);
                  setPicking(null);
                  setProjects(null);
                  notify(`Made ${name} on Supabase and linked ${folderName(f.folder)}; its database password is in the 🔐 vault as ${secret}. It takes a minute or two to start.`);
                })
              }
              onCancel={() => setPicking(null)}
            />
          ) : (
            <FolderSection
              key={f.folder}
              folder={f}
              busy={busy}
              onLink={() => void startPicking(f.folder)}
              onUnlink={() => void change(() => supabase.unlink(f.folder))}
              onRestore={(ref) =>
                void change(async () => {
                  await supabase.restore(ref);
                  notify("Supabase is waking the project; it takes a few minutes");
                })
              }
              onOpenUrl={onOpenUrl}
              cards={cards}
              onOpenCard={onOpenCard}
              onStart={(cwd, prompt, title) => void onStart(cwd, prompt, title).catch(notify)}
            />
          ),
        )}
      </div>
    </div>
  );
}

// Supabase arrived after this Weft started: one restart loads its side of main.
function Restart() {
  const [asked, setAsked] = useState(false);
  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-[11.5px] leading-snug text-muted">
      <p className="text-[12px] font-medium text-ink">Restart Weft to turn on Supabase</p>
      <p>Supabase was added after this Weft started. Restart once, then come back here to add your token. Running cards pick up where they left off.</p>
      <div>
        <button
          onClick={() => {
            window.weft?.splashAction?.("relaunch");
            setAsked(true);
          }}
          disabled={asked}
          className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent disabled:opacity-40"
        >
          {asked ? "Restarting…" : "Restart Weft"}
        </button>
      </div>
    </div>
  );
}

function FolderSection({
  folder: f,
  busy,
  onLink,
  onUnlink,
  onRestore,
  onOpenUrl,
  cards,
  onOpenCard,
  onStart,
}: {
  folder: SupabaseFolder;
  busy: boolean;
  onLink: () => void;
  onUnlink: () => void;
  onRestore: (ref: string) => void;
  onOpenUrl: (url: string) => void;
  cards: Card[];
  onOpenCard: (card: Card) => void;
  onStart: (cwd: string, prompt: string, title: string) => void;
}) {
  const link = f.link;
  // A link the Supabase server made in .mcp.json isn't usable by the CLI yet, so this row offers
  // "Link CLI…" (the shared Unlink would be wrong — nothing Weft wrote is there to remove).
  const extra =
    link && link.source !== "cli" ? (
      <button onClick={onLink} disabled={busy} className={SMALL} title="Linked by the Supabase server in .mcp.json; link it for the Supabase CLI too">
        Link CLI…
      </button>
    ) : undefined;
  return (
    <FolderRow
      folder={f.folder}
      linked={Boolean(link)}
      busy={busy}
      onLink={onLink}
      onUnlink={onUnlink}
      unlinkTitle="Remove supabase/.temp/project-ref from this folder"
      unlinked={f.migrations ? `${f.migrations} local migrations · not linked` : "Not linked to a Supabase project"}
      error={f.error ? { name: link?.name ?? link?.ref ?? "", message: f.error } : null}
      extra={extra}
    >
      {link && <SupabaseLinked folder={f} link={link} busy={busy} onRestore={onRestore} onOpenUrl={onOpenUrl} cards={cards} onOpenCard={onOpenCard} onStart={onStart} />}
    </FolderRow>
  );
}
