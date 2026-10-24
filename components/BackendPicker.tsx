"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { isLive } from "@/lib/format";
import { BACKENDS, CODEX_DEFAULT_MODEL, MODELS, NO_MODEL, runningOn } from "@/lib/new-thread";
import { BACKEND_LABELS, type Backend, type Card } from "@/lib/types";
import { useEscape } from "@/lib/use-escape";
import { useLimitedModels } from "@/lib/use-plan-limits";
import { BackendBadge } from "./CardView";
import Icon from "./Icon";

// A clickable version of the CLI chip for the thread header. Click it and pick a model: one of this
// CLI's swaps the open CLI's model, one of the other CLI's switches CLI and the next turn runs there
// (stop the thread first). No replay by default — that's the rate-limit banner's job (and it
// always replays). The copilot is locked to claude, so it gets the static badge instead.
export default function BackendPicker({ card }: { card: Card }) {
  // Without a "[1m]" context suffix, so it matches a MODELS id.
  const model = runningOn(card).model?.replace(/\[[^\]]*\]$/, "");
  // "" is the CLI's own choice — the card's own model, when it has one. Codex's "Codex default"
  // is the same idea under its own name, so it reads as the default too.
  const selectedModel = card.backend === "codex" && (!model || model === "Codex") ? CODEX_DEFAULT_MODEL : model;
  const onDefault = !selectedModel || selectedModel === CODEX_DEFAULT_MODEL;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const live = isLive(card);
  const locked = card.role === "copilot";
  const atLimit = new Set(useLimitedModels().map((l) => l.model));
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  function pick(next: Backend, id: string) {
    // The same model again is a no-op; "Default model" on a card already on it is too.
    if (next === card.backend && (id === selectedModel || (id === NO_MODEL && onDefault))) return;
    setError(null);
    // A live thread can't change CLI (the server says so), but the user may still pick a model on
    // this CLI. When the move is refused, say why instead of failing silently.
    void api.switchBackend(card.id, next, false, id).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setError(message.replace(/^Error:\s*/, "") || "Couldn't switch.");
    });
  }

  if (locked) return <BackendBadge backend={card.backend} card={card} />;

  const row = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Switch model (currently ${BACKEND_LABELS[card.backend]})`}
        aria-expanded={open}
        title="Switch model or CLI"
        className={`shrink-0 rounded ${model ? "" : "px-0"}`}
      >
        <BackendBadge backend={card.backend} card={card} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-line bg-panel p-1 shadow-lg">
          <div role="group" aria-label="Default">
            <button
              type="button"
              onClick={() => pick(card.backend, NO_MODEL)}
              className={row}
              aria-pressed={onDefault}
            >
              <span className="flex w-[14px] shrink-0 justify-center text-accent">
                {onDefault && <Icon name="check" size={13} />}
              </span>
              <span className="flex-1 font-medium text-ink">Default model</span>
            </button>
          </div>
          {BACKENDS.map((b) => (
            <div key={b.id} role="group" aria-label={b.label}>
              <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-faint">{b.label}</p>
              {MODELS[b.id].map((m) => {
                const on = card.backend === b.id && selectedModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => pick(b.id, m.id)}
                    className={row}
                    aria-pressed={on}
                  >
                    <span className="flex w-[14px] shrink-0 justify-center text-accent">
                      {on && <Icon name="check" size={13} />}
                    </span>
                    <span className="flex-1 font-medium text-ink">
                      {m.label}
                      {atLimit.has(m.id) && <span className="ml-1 text-[11px] text-faint">— at its limit</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {live && <p className="px-2 pb-1 pt-1.5 text-[11px] leading-snug text-faint">Stop the thread to switch CLI.</p>}
          {error && <p role="alert" className="px-2 pb-1 pt-1.5 text-[11px] leading-snug text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
