"use client";

import { useState } from "react";
import { folderName, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import {
  createdText,
  deployState,
  gitLine,
  shownFolders,
  TOKEN_URL,
  vercelActions,
  type VercelBridge,
  type VercelDeployment,
  type VercelFolder,
  type VercelLink,
  type VercelProject,
  type VercelStatus,
} from "@/lib/vercel-view";
import { Note } from "./VaultParts";
import { VaultTokenOffer } from "./VaultTokenOffer";
import { FolderRow } from "./FolderRow";
import { TokenForm } from "./TokenForm";
import { SMALL, TONE } from "./tone";
import VercelPicker from "./VercelPicker";
import VercelEnv from "./VercelEnv";

// The ▲ drawer's body (docs/architecture/vercel.md): your Vercel token, kept by Electron main in the
// Keychain, and each board project's link to a Vercel project, written as .vercel/project.json so the
// Vercel CLI in a thread works on the right project. The drawer shows the top bar's project, or all.
export default function VercelDrawer({
  bridge,
  status,
  error,
  reload,
  project,
  onOpenUrl,
  notify,
}: {
  bridge: VercelBridge | null;
  status: VercelStatus | null;
  error: string | null;
  reload: () => Promise<void>;
  project: string | null;
  // Shows a page in the board's browser pane.
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [projects, setProjects] = useState<VercelProject[] | null>(null);

  if (!bridge) return <Note>Vercel links live in Weft&apos;s desktop app, where Electron keeps your token in the Keychain.</Note>;
  if (error) return <Note>{error}</Note>;
  if (!status) return <Note>Asking Vercel…</Note>;

  const vercel = bridge;

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
          provider="Vercel"
          tokenUrl={TOKEN_URL}
          onSave={(token) =>
            change(async () => {
              const { username } = await vercel.setToken(token);
              setProjects(null);
              notify(`Signed in to Vercel as ${username}`);
            })
          }
          onForget={status.signedIn ? () => void change(() => vercel.forgetToken()) : undefined}
        />
        <VaultTokenOffer
          source={vercel}
          folders={status.folders.map((f) => f.folder)}
          busy={busy}
          onUse={(pick) =>
            change(async () => {
              const r = await vercel.useVaultToken?.(pick);
              if (!r) return;
              if (!("status" in r)) {
                notify("denied" in r ? "Touch ID said no, so nothing changed." : "That vault no longer has the value.");
                return;
              }
              const { username } = r.status;
              setProjects(null);
              notify(`Signed in to Vercel as ${username}`);
            })
          }
        />
      </div>
    );

  async function startPicking(folder: string) {
    setPicking(folder);
    if (projects) return;
    try {
      setProjects(await vercel.projects());
    } catch (err) {
      setPicking(null);
      notify(err);
    }
  }

  const shown = shownFolders(status.folders, project);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate">Signed in as {status.user?.username}</span>
        <button onClick={() => void change(() => vercel.forgetToken())} disabled={busy} className={SMALL} title="Forget the token kept in the Keychain">
          Sign out
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && <Note>Add a project to the board to link it to Vercel.</Note>}
        {shown.map((f) =>
          picking === f.folder ? (
            <VercelPicker
              key={f.folder}
              bridge={vercel}
              folder={f}
              projects={projects}
              busy={busy}
              onPick={(p) =>
                change(async () => {
                  const { name } = await vercel.link(f.folder, p.id, p.orgId);
                  setPicking(null);
                  notify(`Linked ${folderName(f.folder)} to ${name} on Vercel`);
                })
              }
              onCreate={(options) =>
                change(async () => {
                  const result = await vercel.create(f.folder, options);
                  setPicking(null);
                  // The new project belongs in the list next time.
                  setProjects(null);
                  notify(createdText(f.folder, result));
                })
              }
              onCancel={() => setPicking(null)}
              notify={notify}
            />
          ) : (
            <FolderSection
              key={f.folder}
              folder={f}
              busy={busy}
              onLink={() => void startPicking(f.folder)}
              onUnlink={() => void change(() => vercel.unlink(f.folder))}
              onOpenUrl={onOpenUrl}
              env={<VercelEnv folder={f.folder} team={f.link?.orgId ?? null} bridge={vercel} notify={notify} />}
            />
          ),
        )}
      </div>
    </div>
  );
}


function FolderSection({
  folder: f,
  busy,
  onLink,
  onUnlink,
  onOpenUrl,
  env,
}: {
  folder: VercelFolder;
  busy: boolean;
  onLink: () => void;
  onUnlink: () => void;
  onOpenUrl: (url: string) => void;
  // The 🔐 → Vercel env section (components/VercelEnv.tsx), shown once the link reads.
  env: React.ReactNode;
}) {
  const link = f.link;
  return (
    <FolderRow
      folder={f.folder}
      linked={Boolean(link)}
      busy={busy}
      onLink={onLink}
      onUnlink={onUnlink}
      unlinkTitle="Remove .vercel/project.json from this folder"
      unlinked={f.repo ? `${f.repo} · not on Vercel yet` : "Not linked to a Vercel project"}
      error={f.error ? { name: link?.name ?? link?.projectId ?? "", message: f.error } : null}
    >
      {link && <Linked link={link} repo={f.repo} onOpenUrl={onOpenUrl} />}
      {link && <div className="mt-1 text-[11px] text-muted">{env}</div>}
    </FolderRow>
  );
}

function Linked({ link, repo, onOpenUrl }: { link: VercelLink; repo: string | null; onOpenUrl: (url: string) => void }) {
  const git = gitLine(link, repo);
  const { url } = link;
  const actions = vercelActions(link);
  return (
    <div className="mt-1 space-y-1 text-[11px] text-muted">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-ink">▲ {link.name}</span>
        {link.team && <span className="truncate text-faint">{link.team}</span>}
      </div>
      {url && (
        <button onClick={() => onOpenUrl(url)} className="block max-w-full truncate text-left text-accent hover:underline" title="Open in the browser pane">
          {url.replace(/^https:\/\//, "")}
        </button>
      )}
      {link.latest ? <Deploy deploy={link.latest} onOpenUrl={onOpenUrl} /> : <p className="text-faint">No deploys yet</p>}
      <p className={git.warn ? "text-warn" : ""}>{git.text}</p>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
          {actions.map((a) => (
            <button key={a.label} onClick={() => window.weft?.openExternal(a.url)} className="text-faint hover:text-ink" title={a.url}>
              {a.label} ↗
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The latest deploy: its state, where it went, how long ago, and a way to open it.
function Deploy({ deploy, onOpenUrl }: { deploy: VercelDeployment; onOpenUrl: (url: string) => void }) {
  const now = useNow();
  const state = deployState(deploy.state);
  const { url } = deploy;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`rounded px-1 text-[10px] leading-[15px] ${TONE[state.tone]}`}>{state.label}</span>
      <span className="text-faint">
        {deploy.target === "production" ? "production" : "preview"} · {timeAgo(deploy.createdAt, now)}
      </span>
      {url && (
        <button onClick={() => onOpenUrl(url)} className="ml-auto text-faint hover:text-ink" title="Open this deploy in the browser pane">
          open
        </button>
      )}
    </div>
  );
}
