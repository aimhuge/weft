"use client";

import { useState } from "react";
import {
  countsLine,
  createProperty,
  expiryNote,
  needsRestart,
  platformName,
  queueOf,
  shownFolders,
  untilText,
  weftConnectNote,
  type BlastcpBridge,
  type BlastcpFolder,
  type BlastcpPost,
  type BlastcpStatus,
  type BlastcpWorkspace,
} from "@/lib/blastcp-view";
import { api } from "@/lib/client";
import { folderName, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { BlastcpConnect, BlastcpRestart, SMALL } from "./BlastcpConnect";
import BlastcpLogo from "./BlastcpLogo";
import BlastcpPicker from "./BlastcpPicker";
import { FolderRow } from "./FolderRow";
import { Note } from "./VaultParts";

// The posts a property shows coming up.
const NEXT = 4;

// The BlastCP drawer's body (docs/architecture/blastcp.md): your BlastCP sign-in, kept by Electron main in the
// Keychain, and the property each board project posts as, with what goes out next. Clicking a post opens
// its BlastCP page in the browser pane.
export default function BlastcpDrawer({
  bridge,
  status,
  error,
  reload,
  project,
  onOpenUrl,
  notify,
}: {
  bridge: BlastcpBridge | null;
  status: BlastcpStatus | null;
  error: string | null;
  reload: () => Promise<void>;
  project: string | null;
  // Shows a page in the board's browser pane.
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
}) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<BlastcpWorkspace[] | null>(null);

  if (!bridge) return <Note>BlastCP lives in Weft&apos;s desktop app, where Electron keeps your sign-in in the Keychain.</Note>;
  if (needsRestart(error)) return <BlastcpRestart />;
  if (error) return <Note>{error}</Note>;
  if (!status) return <Note>Asking BlastCP…</Note>;

  const blastcp = bridge;

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

  const connect = () =>
    void change(async () => {
      const { email } = await blastcp.connect();
      setWorkspaces(null);
      notify(`Connected to BlastCP as ${email}`);
    });

  // Your Weft account's sign-in swapped for a BlastCP one (lib/blastcp-auto.ts); BlastCP makes the account the first time.
  const connectWeft = () =>
    void change(async () => {
      const result = await api.connectBlastcpWithWeft();
      setWorkspaces(null);
      const created = result.state === "connected" && result.created;
      notify(weftConnectNote(result) ?? (created ? "Made your BlastCP account and connected it" : "Connected to BlastCP with your Weft account"));
    });

  if (!status.signedIn || status.error)
    return (
      <BlastcpConnect
        error={status.error}
        busy={busy}
        linkUrl={status.linkUrl}
        onWeft={connectWeft}
        onConnect={connect}
        onOpenUrl={onOpenUrl}
        onForget={status.signedIn ? () => void change(() => blastcp.forget()) : undefined}
      />
    );

  async function startPicking(folder: string) {
    setPicking(folder);
    if (workspaces) return;
    try {
      setWorkspaces(await blastcp.workspaces());
    } catch (err) {
      setPicking(null);
      notify(err);
    }
  }

  const expiry = expiryNote(status.expiresAt, now);
  const shown = shownFolders(status.folders, project);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate" title={expiry ?? (status.viaWeft ? "Connected with your Weft account; Weft renews it" : undefined)}>
          {status.user?.email}
          {expiry && <span className="text-warn"> · {expiry}</span>}
        </span>
        {expiry && (
          <button onClick={status.viaWeft ? connectWeft : connect} disabled={busy} className={SMALL}>
            Reconnect
          </button>
        )}
        <button onClick={() => void change(() => blastcp.forget())} disabled={busy} className={SMALL} title="Forget the sign-in kept in the Keychain">
          Sign out
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && <Note>Add a project to the board to link it to a BlastCP property.</Note>}
        {shown.map((f) =>
          picking === f.folder ? (
            <BlastcpPicker
              key={f.folder}
              folder={f.folder}
              workspaces={workspaces}
              busy={busy}
              onPick={(o) =>
                change(async () => {
                  const { name } = await blastcp.link(f.folder, o.org, o.slug, o.name);
                  setPicking(null);
                  notify(`${folderName(f.folder)} now posts as ${name} on BlastCP`);
                })
              }
              onCreate={(org, name) =>
                change(async () => {
                  const made = await createProperty(blastcp, f.folder, org, name);
                  setPicking(null);
                  // The next pick lists the new property too.
                  setWorkspaces(null);
                  notify(`Made ${made.name} on BlastCP; ${folderName(f.folder)} now posts as it`);
                })
              }
              onCancel={() => setPicking(null)}
              onOpenUrl={onOpenUrl}
            />
          ) : (
            <FolderSection key={f.folder} folder={f} busy={busy} now={now} onLink={() => void startPicking(f.folder)} onUnlink={() => void change(() => blastcp.unlink(f.folder))} onOpenUrl={onOpenUrl} />
          ),
        )}
      </div>
    </div>
  );
}

function FolderSection({
  folder: f,
  busy,
  now,
  onLink,
  onUnlink,
  onOpenUrl,
}: {
  folder: BlastcpFolder;
  busy: boolean;
  now: number;
  onLink: () => void;
  onUnlink: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const link = f.link;
  return (
    <FolderRow
      folder={f.folder}
      linked={Boolean(link)}
      busy={busy}
      onLink={onLink}
      onUnlink={onUnlink}
      unlinkTitle="Stop showing this property here (nothing changes on BlastCP)"
      unlinked="Not linked to a BlastCP property"
    >
      {link && (
        <div className="mt-1 space-y-1 text-[11px] text-muted">
          <button onClick={() => onOpenUrl(`${link.url}/queue`)} className="block max-w-full truncate text-left text-[12px] text-ink hover:underline" title="Open its queue in the browser pane">
            <BlastcpLogo size={12} /> {link.name} <span className="text-faint">· {link.org}</span>
          </button>
          {f.error ? <p className="text-danger">{f.error}</p> : f.posts ? <Queue posts={f.posts} now={now} draftsUrl={`${link.url}/drafts`} onOpenUrl={onOpenUrl} /> : <p className="text-faint">Loading posts…</p>}
        </div>
      )}
    </FolderRow>
  );
}

function Queue({ posts, now, draftsUrl, onOpenUrl }: { posts: BlastcpPost[]; now: number; draftsUrl: string; onOpenUrl: (url: string) => void }) {
  const q = queueOf(posts, now);
  const counts = countsLine(q);
  return (
    <>
      {q.next.length === 0 ? (
        <p className="text-faint">Nothing scheduled</p>
      ) : (
        <ul className="space-y-0.5">
          {q.next.slice(0, NEXT).map((p) => (
            <li key={p.id}>
              <PostRow post={p} when={untilText(p.scheduledFor, now)} onOpenUrl={onOpenUrl} />
            </li>
          ))}
          {q.next.length > NEXT && <li className="text-faint">+{q.next.length - NEXT} more scheduled</li>}
        </ul>
      )}
      {counts && (
        <button onClick={() => onOpenUrl(draftsUrl)} className={q.failed ? "text-danger hover:underline" : "text-warn hover:underline"} title="Open drafts in the browser pane">
          {counts}
        </button>
      )}
      {q.last && <p className="truncate text-faint">Last out {timeAgo(q.last.publishedAt, now)}: {platformName(q.last.platform)}</p>}
    </>
  );
}

function PostRow({ post, when, onOpenUrl }: { post: BlastcpPost; when: string; onOpenUrl: (url: string) => void }) {
  const url = post.reviewUrl;
  return (
    <button onClick={() => url && onOpenUrl(url)} disabled={!url} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-sunken" title={post.title ?? undefined}>
      <span className="w-[52px] shrink-0 text-faint">{when}</span>
      <span className="shrink-0 rounded bg-sunken px-1 text-[10px] leading-[15px]">{platformName(post.platform)}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{post.title ?? "Untitled"}</span>
    </button>
  );
}
