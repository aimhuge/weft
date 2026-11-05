"use client";

// The project menu's "Clone from GitHub" form: owner/name or a github.com URL, cloned into ~/dev as a new project,
// with the clone's progress bar under it while it runs (components/CloneProgress.tsx). With a headless worker of
// yours, a picker in the same row sends the clone there instead, with no thread, and waits for its real result
// (docs/architecture/weft-worker.md#cloning-onto-a-worker).
import { useState } from "react";
import { api } from "@/lib/client";
import { useWorkers } from "@/lib/use-workers";
import { Spinner } from "./Icon";
import CloneProgress from "./CloneProgress";
import { FIELD, SUBMIT } from "./project-menu-styles";

const TARGET = "w-[92px] shrink-0 rounded-md border border-line-strong bg-canvas px-1 py-1.5 text-[12px] text-ink outline-none focus:border-accent";

export default function ProjectCloneForm({
  value,
  onChange,
  busy,
  onError,
  onNotice,
  run,
}: {
  value: string;
  onChange: (next: string) => void;
  busy: boolean;
  onError: (message: string) => void;
  // The board's toast: a clone on a worker can outlast this menu, and its result must still reach you.
  onNotice?: (message: string) => void;
  // The menu's runner: selects the folder the action returns, shows its error.
  run: (action: () => Promise<string | null>) => Promise<void>;
}) {
  // The owner/name being cloned, so its progress bar shows under the form.
  const [cloning, setCloning] = useState<string | null>(null);
  const [onWorker, setOnWorker] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Empty is this Mac.
  const [target, setTarget] = useState("");
  const { view, clone } = useWorkers();
  const workers = (view?.workers ?? []).filter((w) => w.mine && w.kind === "headless");

  async function cloneOnWorker(slug: string, workerId: string, name: string) {
    setOnWorker(name);
    try {
      const { status } = await clone(workerId, slug);
      const done = `Cloned ${slug} onto ${name}, in the folder ${slug.split("/")[1]}.`;
      const queued = `${name} hasn't picked up ${slug} yet. It may be offline. If the clone fails, its row in Settings → Sync → Workers says why.`;
      const message = status === "done" ? done : queued;
      setNote(message);
      onNotice?.(message);
    } catch (err) {
      onNotice?.(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setOnWorker(null);
    }
    return null;
  }

  function submit(e: React.SubmitEvent) {
    e.preventDefault();
    setNote(null);
    const slug = value.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) {
      onError("Use owner/name, like aimhuge/weft.");
      return;
    }
    const worker = workers.find((w) => w.id === target);
    if (worker) {
      void run(() => cloneOnWorker(slug, worker.id, worker.name));
      return;
    }
    setCloning(slug);
    void run(async () => (await api.cloneRepo(slug)).path).finally(() => setCloning(null));
  }

  return (
    <>
      <form onSubmit={submit} className="flex gap-1.5 px-2.5 pb-2 pt-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="owner/name or github.com URL"
          aria-label="GitHub repo"
          className={`${FIELD} font-mono`}
        />
        {workers.length > 0 && (
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy} aria-label="Clone to" className={TARGET}>
            <option value="">This Mac</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.status === "offline" ? " (offline)" : ""}
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={busy} className={SUBMIT}>
          {busy ? "Cloning…" : "Clone"}
        </button>
      </form>
      {cloning && (
        <div className="px-2.5 pb-2">
          <CloneProgress fullName={cloning} />
        </div>
      )}
      {onWorker && (
        <p className="flex items-center gap-1.5 px-2.5 pb-2 text-[12px] text-muted">
          <Spinner size={11} /> Cloning on {onWorker}
        </p>
      )}
      {note && <p className="px-2.5 pb-2 text-[12px] text-muted">{note}</p>}
    </>
  );
}
