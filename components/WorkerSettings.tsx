"use client";

// The Workers card on Settings → Sync: the Weft Workers in your workspace (docs/architecture/weft-worker.md), the
// boxes that run cards headless, each with its status and a Remove. "Add a worker" makes a one-time token and shows
// the line to run on the box; "Send a run" queues a prompt on one of yours, and its card syncs back to the web board.

import { useState } from "react";
import { timeAgo } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { useWorkers } from "@/lib/use-workers";
import type { WorkerView } from "@/lib/workers-account";
import { Spinner } from "./Icon";
import WorkerGithubSignIn, { githubLine } from "./WorkerGithubSignIn";
import WorkerSignIn from "./WorkerSignIn";
import WorkerUpdateButton from "./WorkerUpdateButton";

const CARD = "rounded-xl border border-line-strong bg-panel/85 p-5 shadow-lg backdrop-blur-xl";
const SECTION_TITLE = "mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint";
const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";
const INPUT = "w-full rounded-md border border-line-strong bg-sunken px-2 py-1 text-[12.5px] text-ink";
const DOT: Record<WorkerView["status"], string> = { online: "bg-emerald-500", busy: "bg-amber-400", offline: "bg-zinc-500" };

function RunForm({ workers, run }: { workers: WorkerView[]; run: ReturnType<typeof useWorkers>["run"] }) {
  const [workerId, setWorkerId] = useState(workers[0]?.id ?? "");
  const [folder, setFolder] = useState("");
  const [repo, setRepo] = useState("");
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<{ busy?: boolean; sent?: boolean; error?: string }>({});

  async function onSend() {
    setState({ busy: true });
    try {
      await run({ workerId, folder, prompt, repo: repo || undefined });
      setPrompt("");
      setState({ sent: true });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex gap-2">
        {workers.length > 1 && (
          <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} className={INPUT} aria-label="Worker">
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Project folder on the worker, e.g. weft" className={INPUT} />
      </div>
      <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="Git URL to clone it from, the first time" className={INPUT} />
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="What should it do?" className={INPUT} />
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void onSend()} disabled={state.busy || !folder.trim() || !prompt.trim()} className={`flex items-center gap-1.5 ${BUTTON}`}>
          {state.busy && <Spinner size={11} />}
          Send a run
        </button>
        {state.sent && <span className={SUBTLE}>Sent. Its card shows up on the web board when the worker picks it up.</span>}
      </div>
      {state.error && <p className="text-[12.5px] text-danger">{state.error}</p>}
    </div>
  );
}

// Under a worker's name: its GitHub sign-in, and why your latest clone onto it failed.
function GithubStatusLine({ worker }: { worker: WorkerView }) {
  const line = githubLine(worker);
  return (
    <>
      {line && <div className={line.warn ? "text-[12.5px] text-warn" : SUBTLE}>{line.text}</div>}
      {worker.cloneError && <div className="text-[12.5px] text-danger">Clone failed: {worker.cloneError}</div>}
    </>
  );
}

export default function WorkerSettings() {
  const { view, error, token, run, login, github, update, remove } = useWorkers();
  const now = useNow();
  const [install, setInstall] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function onAdd() {
    setFailed(null);
    try {
      setInstall((await token()).command);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    }
  }

  async function onRemove(id: string) {
    setFailed(null);
    await remove(id).catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)));
  }

  const workers = view?.workers ?? [];
  // A run goes to one of your workers other than this Mac, which would just be a new card here.
  const mine = workers.filter((w) => w.mine && !w.here);
  return (
    <section data-settings-card className={CARD} onMouseDown={(e) => e.stopPropagation()}>
      <h4 className={SECTION_TITLE}>Workers</h4>
      {!view && !error ? (
        <p className={`flex items-center gap-2 ${SUBTLE}`}>
          <Spinner size={11} /> Loading
        </p>
      ) : workers.length === 0 ? (
        <p className={SUBTLE}>A worker is a Mac or Linux box that runs cards headless while your laptop sleeps. Add one with the line below. A Weft desktop that syncs a folder lists itself here too, as a headed worker.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {workers.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[w.status]}`} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-ink">{w.name}</div>
                  <div className={SUBTLE}>
                    {w.status} · {w.kind === "desktop" ? (w.here ? "headed, this Mac" : "headed") : "headless"} · {w.platform}/{w.arch}
                    {w.build && ` · ${w.build}`}
                    {w.lastSeenAt && ` · seen ${timeAgo(Date.parse(w.lastSeenAt), now)}`}
                  </div>
                  {w.updateNote && <div className="text-[12.5px] text-warn">{w.updateNote}</div>}
                  {w.mine && w.kind !== "desktop" && <GithubStatusLine worker={w} />}
                </div>
              </div>
              {w.mine && w.kind !== "desktop" && (
                <div className="flex max-w-full flex-wrap justify-end gap-2">
                  <WorkerUpdateButton offline={w.status === "offline"} send={() => update(w.id)} />
                  <WorkerSignIn name={w.name} send={(t) => login(w.id, t)} />
                  <WorkerGithubSignIn name={w.name} state={w.githubState} send={(t) => github(w.id, t)} />
                  <button type="button" onClick={() => void onRemove(w.id)} className={BUTTON}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        {install ? (
          <div className="flex flex-col gap-1.5">
            <p className={SUBTLE}>Run this on the box within the hour. The token works once.</p>
            <code className="block break-all rounded-md bg-sunken px-2 py-1.5 text-[12px] text-ink select-all">{install}</code>
          </div>
        ) : (
          <button type="button" onClick={() => void onAdd()} className={BUTTON}>
            Add a worker
          </button>
        )}
      </div>
      {mine.length > 0 && <RunForm workers={mine} run={run} />}
      {error && <p className="mt-3 text-[12.5px] text-danger">Couldn&apos;t read your workers: {error}</p>}
      {failed && <p className="mt-3 text-[12.5px] text-danger">{failed}</p>}
    </section>
  );
}
