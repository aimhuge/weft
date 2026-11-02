"use client";

// New thread on the weft.zip board: pick one of your synced folders (a Mac's or a worker's), write a prompt, send.
// Nothing runs here: the machine that owns the folder gets a `new_card` command (lib/cloud-inbox-cards.ts on a Mac,
// lib/worker-kinds.ts on a worker) and starts the card, which then shows up on the board by itself. The desktop's own
// dialog is a Composer over a local folder picker; a browser tab has neither, so this is a prompt box with the
// desktop's own pickers: the model menu that picks the CLI too (ModelSelect), the effort, the mode picker (ModePicker,
// never skip-permissions) and, on a worker, Plan first; tags; and Backlog, which makes the card there without starting it.
import { useState } from "react";
import type { NewCardForm, NewCardMode } from "@/lib/cloud-commands";
import { EFFORTS, NO_MODEL, resolveModel } from "@/lib/new-thread";
import type { Backend, Effort, PermissionMode } from "@/lib/types";
import type { WebTarget } from "@/lib/web-commands";
import Modal from "../Modal";
import ModePicker from "../ModePicker";
import ModelSelect, { SELECT_CLASS } from "../ModelSelect";
import { track } from "@/lib/analytics";

// A worker's device id is `worker:<id>` (lib/worker-commands.ts workerDevice, which this client can't import: it seals).
const isWorkerDevice = (device: string) => device.startsWith("worker:");

type Send = (target: WebTarget, form: NewCardForm) => Promise<string | null>;

// The CLI, model, effort, mode, tags and Backlog, as the form sends them.
function useNewCardForm() {
  // The CLI the menu shows; sent only once you pick one, so the machine's own default CLI holds otherwise.
  const [backend, setBackend] = useState<Backend>("claude");
  const [cliPicked, setCliPicked] = useState(false);
  const [model, setModelState] = useState("");
  const [effort, setEffort] = useState<Effort | "">("");
  // The mode, sent once you pick one (each machine has its own default); plan first only on a worker.
  const [mode, setModeState] = useState<PermissionMode | null>(null);
  const [plan, setPlan] = useState(false);
  const [tags, setTags] = useState("");
  const [backlog, setBacklog] = useState(false);
  const setModel = (next: string) => {
    setModelState(next);
    const resolved = resolveModel(next);
    if (resolved) setBackend(resolved.backend);
  };
  const pickCli = (next: Backend) => {
    setBackend(next);
    setCliPicked(true);
    setModelState(NO_MODEL);
  };
  const setMode = (next: PermissionMode) => setModeState(next);
  const permissionMode = (worker: boolean): NewCardMode | undefined => {
    if (worker && plan) return "plan";
    return mode && mode !== "bypassPermissions" ? mode : undefined;
  };
  const form = (prompt: string, worker: boolean): NewCardForm => ({
    prompt,
    model,
    effort,
    ...(cliPicked ? { backend } : {}),
    permissionMode: permissionMode(worker),
    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    backlog,
  });
  return { backend, model, effort, mode: mode ?? "default", plan, tags, backlog, setModel, pickCli, setEffort, setMode, setPlan, setTags, setBacklog, form };
}

export function WebNewCardDialog({
  targets,
  defaultFolder,
  onSend,
  onClose,
}: {
  targets: WebTarget[];
  // The project chip selected on the board, if it is one of the targets.
  defaultFolder: string | null;
  // Resolves to why it couldn't be sent, or null once it is.
  onSend: Send;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, targets.findIndex((t) => t.folder === defaultFolder)));
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picks = useNewCardForm();
  const target = targets[index];
  // A worker has no Backlog yet: its cards start when they're made.
  const worker = target ? isWorkerDevice(target.device) : false;
  const backlog = picks.backlog && !worker;

  async function send() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    const problem = await onSend(target, { ...picks.form(prompt, worker), backlog });
    setBusy(false);
    if (problem) setError(problem);
    else {
      track("thread_started", { model: picks.model || "default", effort: picks.effort || "default" });
      onClose();
    }
  }

  const where = worker ? "Runs on your worker, in" : "Runs on your Mac, in";
  return (
    <Modal title="New thread" onClose={onClose} className="w-full max-w-[560px]">
      <div className="flex flex-col gap-3 p-4">
        {!target ? (
          <p className="text-[13px] leading-relaxed text-muted">
            No folder to start it in yet. Turn on Sync for a project in the Weft desktop app (<strong className="text-ink">Settings → Sync</strong>) and let it sync a card, then it shows up here.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              {where}
              <select value={index} onChange={(e) => setIndex(Number(e.target.value))} className={SELECT_CLASS} aria-label="Project">
                {targets.map((t, i) => (
                  <option key={`${t.device}:${t.folder}`} value={i}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
              }}
              rows={7}
              placeholder="What should it do?"
              aria-label="Prompt"
              className="resize-y rounded-md border border-line-strong bg-canvas p-3 text-[13.5px] leading-relaxed text-ink outline-none focus:border-accent"
            />
            <Pickers picks={picks} worker={worker} />
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={picks.tags}
                onChange={(e) => picks.setTags(e.target.value)}
                placeholder="Tags, comma separated"
                aria-label="Tags"
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-2.5 py-[6px] text-[12.5px] text-ink outline-none focus:border-accent"
              />
              <label className="flex items-center gap-1.5 text-[12.5px] text-muted" title={worker ? "A worker has no Backlog yet: its threads start when they're made." : "Make the card in Backlog and start it later"}>
                <input type="checkbox" checked={backlog} disabled={worker} onChange={(e) => picks.setBacklog(e.target.checked)} />
                Backlog
              </label>
              <button
                onClick={() => void send()}
                disabled={busy || !prompt.trim()}
                className="rounded-md bg-accent px-3.5 py-[7px] text-[12.5px] font-medium text-on-accent disabled:opacity-50"
              >
                {busy ? "Sending…" : backlog ? "Add to Backlog" : worker ? "Start on my worker" : "Start on my Mac"}
              </button>
            </div>
            {error && (
              <p role="alert" className="text-[12.5px] text-warn">
                {error}
              </p>
            )}
            <p className="text-[11.5px] leading-relaxed text-faint">
              The machine has to be on and running Weft. A thread that needs a yes waits for you in Needs you.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

// The model (which picks the CLI too), the effort and the mode.
// On a worker, Plan first starts the thread in plan mode (lib/worker-commands.ts RUN_MODES); a Mac has no plan mode.
function Pickers({ picks, worker }: { picks: ReturnType<typeof useNewCardForm>; worker: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ModelSelect value={picks.model} label="Model" leading={[{ value: NO_MODEL, label: "Default model" }]} onChange={picks.setModel} cli={{ backend: picks.backend, onPick: picks.pickCli }} />
      {picks.backend !== "puku" && (
        <select value={picks.effort} onChange={(e) => picks.setEffort(e.target.value as Effort | "")} className={SELECT_CLASS} aria-label="Effort">
          {EFFORTS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      )}
      <ModePicker value={picks.mode} onChange={picks.setMode} backend={picks.backend} yolo={false} disabled={worker && picks.plan} />
      {worker && (
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted" title="Starts in plan mode: it reads and plans, and asks before it changes anything">
          <input type="checkbox" checked={picks.plan} onChange={(e) => picks.setPlan(e.target.checked)} />
          Plan first
        </label>
      )}
    </div>
  );
}
