"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { folderName } from "@/lib/format";
import { LANDING_LABELS } from "@/lib/issue-landing";
import { INSTALL_URL, issuesUrl, LOGIN_COMMAND, repoUrl, shownGithubFolders, syncLine, syncToast, workflowOfFolder, type GithubFolder, type GithubStatus, type IssueWorkflow } from "@/lib/github-view";
import GithubLogo from "./GithubLogo";
import IssueWorkflowPicker from "./IssueWorkflowPicker";
import { Note } from "./VaultParts";

// The GitHub drawer's body (docs/architecture/github-issues.md): who the gh CLI is signed in as, and per board
// project its repo and the switch that makes its open issues cards, synced every 5 minutes. gh keeps its
// own token; Weft only runs it. The drawer shows the top bar's project, or all.
//
// Under the sync switch: where a new issue's card lands, and how a "run" card works — the skill that
// validates it first and the agent that does the work (lib/issue-landing.ts).

export default function GithubDrawer({
  status,
  error,
  reload,
  project,
  onOpenUrl,
  notify,
}: {
  status: GithubStatus | null;
  error: string | null;
  reload: () => Promise<void>;
  project: string | null;
  // Shows a page in the board's browser pane.
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // A folder's switches as you just set them, drawn until the reload after the change brings the server's.
  const [drawn, setDrawn] = useState<Record<string, Partial<GithubFolder>>>({});

  if (error) return <Note>{error}</Note>;
  if (!status) return <Note>Asking GitHub…</Note>;
  const account = status.account;
  if (!account) return <SignIn error={status.error} onCheck={reload} />;

  // show: what the switch now says, drawn at once so the click never looks ignored; a refusal (and the reload
  // after any change) puts the server's back.
  async function change(folder: string, run: () => Promise<unknown>, show?: Partial<GithubFolder>) {
    setBusy(folder);
    if (show) setDrawn((d) => ({ ...d, [folder]: show }));
    try {
      await run();
      await reload();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(null);
      setDrawn((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== folder)));
    }
  }

  const sync = (folder: string, show?: Partial<GithubFolder>) => change(folder, async () => notify(syncToast(folder, await api.importIssues(folder))), show);
  const shown = shownGithubFolders(status.folders, project);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate">
          Signed in ·{" "}
          <button onClick={() => onOpenUrl(account.url)} className="text-ink hover:underline" title="Your GitHub profile, in the browser pane">
            @{account.login}
          </button>
        </span>
        <span className="text-faint" title="Weft runs the gh CLI with its own sign-in; sign out with gh auth logout">
          via gh
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {status.instantError && <p className="mt-2 px-1 text-[11px] text-danger">{status.instantError}</p>}
        {shown.length === 0 && <Note>Add a project to the board to sync its GitHub issues.</Note>}
        {shown.map((f) => (
          <FolderSection
            key={f.folder}
            folder={{ ...f, ...drawn[f.folder] }}
            busy={busy === f.folder}
            onSync={() => void sync(f.folder, f.syncing ? undefined : { syncing: true })}
            onStop={() =>
              void change(
                f.folder,
                async () => {
                  await api.stopIssues(f.folder);
                  notify(`Stopped syncing GitHub issues for ${folderName(f.folder)}; its cards stay`);
                },
                { syncing: false },
              )
            }
            weft={status.weft}
            onInstant={(on) =>
              void change(f.folder, async () => {
                if (on) {
                  const { repo } = await api.addHook(f.folder);
                  notify(`${repo} now sends its issue changes to Weft as they happen`);
                } else {
                  await api.removeHook(f.folder);
                  notify(`Took the webhook off ${f.repo ?? folderName(f.folder)}; it syncs every 5 minutes`);
                }
              }, { instant: on })
            }
            onOpenUrl={onOpenUrl}
            onWorkflow={(workflow) =>
              void change(
                f.folder,
                async () => {
                  await api.setIssueWorkflow(f.folder, workflow);
                  notify(workflowLine(folderName(f.folder), workflow));
                },
                { workflow },
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

// What the toast says after the workflow changed.
function workflowLine(name: string, workflow: IssueWorkflow) {
  const where = workflow.landing === "run" ? "run on their own" : workflow.landing === "needs_you" ? "land in Needs you" : "land in Backlog";
  const how = workflow.landing === "run" && workflow.skill ? ` after ${workflow.skill} checks them` : "";
  return `New issues for ${name} ${where}${how}`;
}

function SignIn({ error, onCheck }: { error: string | null; onCheck: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  const missing = Boolean(error && /isn't installed/.test(error));
  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-[11.5px] leading-snug text-muted">
      {error && <p className="rounded-md bg-danger-soft px-2 py-1.5 text-danger">{error}</p>}
      <p>
        Weft reads GitHub through the{" "}
        <a
          href={INSTALL_URL}
          onClick={(e) => {
            e.preventDefault();
            window.weft?.openExternal(INSTALL_URL);
          }}
          className="text-accent underline"
        >
          GitHub CLI
        </a>
        , with its own sign-in: Weft never holds a GitHub token.
      </p>
      <p>{missing ? "Install it, then sign in, in a terminal:" : "Sign in once, in a terminal:"}</p>
      {missing && <code className="block select-all rounded bg-sunken px-2 py-1 text-[11.5px] text-ink">brew install gh</code>}
      <code className="block select-all rounded bg-sunken px-2 py-1 text-[11.5px] text-ink">{LOGIN_COMMAND}</code>
      <div>
        <button
          onClick={() => {
            setChecking(true);
            void onCheck().finally(() => setChecking(false));
          }}
          disabled={checking}
          className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent disabled:opacity-40"
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
    </div>
  );
}

// The "instant" switch: a webhook on the repo sends its issue changes through Weft's Supabase, so
// the cards follow within seconds. It needs a Weft account to relay them, so without one the switch
// says so and stays off.
function InstantSwitch({ folder, busy, weft, onInstant }: { folder: GithubFolder; busy: boolean; weft: boolean; onInstant: (on: boolean) => void }) {
  return (
    <label
      className="flex items-center gap-1.5"
      title={
        weft
          ? "A webhook on the repo sends issue changes through Weft's Supabase, so cards follow within seconds. Needs admin on the repo."
          : "Instant updates come through your Weft account: sign in from the top bar first"
      }
    >
      <input type="checkbox" checked={folder.instant} disabled={busy || (!weft && !folder.instant)} onChange={() => onInstant(!folder.instant)} className="accent-accent" />
      <span className={weft ? "text-ink" : "text-faint"}>{weft ? "Instant, by webhook" : "Instant: sign in to Weft first"}</span>
    </label>
  );
}

function FolderSection({
  folder: f,
  busy,
  weft,
  onSync,
  onStop,
  onInstant,
  onOpenUrl,
  onWorkflow,
}: {
  folder: GithubFolder;
  busy: boolean;
  // Signed in to a Weft account, which the webhook relay needs.
  weft: boolean;
  onSync: () => void;
  onStop: () => void;
  onInstant: (on: boolean) => void;
  onOpenUrl: (url: string) => void;
  onWorkflow: (workflow: IssueWorkflow) => void;
}) {
  const line = syncLine(f);
  const repo = f.repo;
  const workflow = workflowOfFolder(f);
  return (
    <section className="mt-2 rounded-lg border border-line bg-card px-2.5 py-2">
      <h3 className="truncate text-[12px] font-semibold text-ink" title={f.folder}>
        {folderName(f.folder)}
      </h3>
      {!repo ? (
        <p className="mt-0.5 text-[11px] text-faint">{f.error ?? "No GitHub remote"}</p>
      ) : (
        <div className="mt-1 space-y-1 text-[11px] text-muted">
          <button onClick={() => onOpenUrl(repoUrl(repo))} className="flex max-w-full items-center gap-1.5 text-left text-[12px] text-ink hover:underline" title="Open the repo in the browser pane">
            <GithubLogo size={12} />
            <span className="truncate">{repo}</span>
          </button>
          <label className="flex items-center gap-1.5" title="Each open issue becomes a card, checked every 5 minutes; a closed issue archives a card that never started">
            <input type="checkbox" checked={f.syncing} disabled={busy} onChange={() => (f.syncing ? onStop() : onSync())} className="accent-accent" />
            <span className="text-ink">Issues → {LANDING_LABELS.find((l) => l.id === workflow.landing)?.label ?? "cards"}</span>
          </label>
          {f.syncing && <InstantSwitch folder={f} busy={busy} weft={weft} onInstant={onInstant} />}
          {f.syncing && <IssueWorkflowPicker workflow={workflow} folder={f.folder} busy={busy} onChange={onWorkflow} />}
          {line && <p className={line.bad ? "text-danger" : "text-faint"}>{busy ? "Syncing…" : line.text}</p>}
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            {f.syncing && (
              <button onClick={onSync} disabled={busy} className="text-faint hover:text-ink disabled:opacity-40" title="Read the issues now instead of waiting for the next 5-minute check">
                Sync now
              </button>
            )}
            <button onClick={() => onOpenUrl(issuesUrl(repo))} className="text-faint hover:text-ink" title="The repo's issues, in the browser pane">
              Issues
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
