"use client";

// New thread on the weft.zip board: pick one of your synced folders, write a prompt, send. Nothing runs here:
// the Mac that owns the folder gets a command (lib/cloud-inbox.ts) and starts the card, which then shows up on
// the board by itself. The desktop's own dialog is a Composer over a local folder picker; a browser tab has
// neither, so this is a prompt box and two menus on the desktop's Modal and pickers.
import { useState } from "react";
import type { Effort } from "@/lib/types";
import { EFFORTS } from "@/lib/new-thread";
import type { WebTarget } from "@/lib/web-commands";
import Modal from "../Modal";
import ModelSelect, { SELECT_CLASS } from "../ModelSelect";
import { track } from "@/lib/analytics";

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
  onSend: (target: WebTarget, form: { prompt: string; model: string; effort: Effort | "" }) => Promise<string | null>;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, targets.findIndex((t) => t.folder === defaultFolder)));
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<Effort | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targets[index];

  async function send() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    const problem = await onSend(target, { prompt, model, effort });
    setBusy(false);
    if (problem) setError(problem);
    else {
      track("thread_started", {
        model: model || "default",
        effort: effort || "default",
      });
      onClose();
    }
  }

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
              Runs on your Mac, in
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
            <div className="flex flex-wrap items-center gap-2">
              <ModelSelect value={model} label="Model" leading={[{ value: "", label: "Default model" }]} onChange={setModel} />
              <select value={effort} onChange={(e) => setEffort(e.target.value as Effort | "")} className={SELECT_CLASS} aria-label="Effort">
                {EFFORTS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
              <div className="flex-1" />
              <button
                onClick={() => void send()}
                disabled={busy || !prompt.trim()}
                className="rounded-md bg-accent px-3.5 py-[7px] text-[12.5px] font-medium text-on-accent disabled:opacity-50"
              >
                {busy ? "Sending…" : "Start on my Mac"}
              </button>
            </div>
            {error && (
              <p role="alert" className="text-[12.5px] text-warn">
                {error}
              </p>
            )}
            <p className="text-[11.5px] leading-relaxed text-faint">
              Your Mac has to be on and running Weft. It uses its own permission setting, so a thread that needs a yes waits for you in Needs you.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
