"use client";

// Settings → Agents → "Build it with a thread" (docs/architecture/agents.md): a card on the board that writes an
// agent's soul and saves it. Typing a soul into a text box is a bad way to make an agent — a soul is a system
// prompt, and a thread that knows the shape of one writes a far better one than a sentence of wishes.
//
// The button asks what the agent is for, spawns the card, and says where to watch it. The card saves the agent
// with the create_agent tool (lib/agent-tools.ts), so it lands in the list like any other agent.

import { useState } from "react";
import { api } from "@/lib/client";
import { errorText } from "@/lib/new-thread";
import { BUTTON_PRIMARY } from "./button-styles";

const FIELD = "rounded-md border border-line-strong bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

export default function AgentBuilder({ onSpawned }: { onSpawned?: (cardId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  async function spawn() {
    setBusy(true);
    setError(null);
    try {
      const { card } = await api.authorAgent({ what });
      setSaid(`“${card.title}” is on your board and running. The agent appears here when it saves it.`);
      setWhat("");
      onSpawned?.(card.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <button type="button" className="self-start text-[12.5px] text-accent hover:underline" onClick={() => setOpen(true)}>
          Build it with a thread
        </button>
        {said && <p className="text-[12.5px] text-muted">{said}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-canvas/60 p-3">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium text-ink">What should the agent be for?</span>
        <span className="text-[12.5px] text-muted">
          A sentence is enough. A thread on your board reads it, writes the agent&apos;s soul and saves the agent.
        </span>
      </div>
      <textarea
        aria-label="What the agent is for"
        value={what}
        onChange={(e) => setWhat(e.target.value)}
        rows={3}
        placeholder="Reviews pull requests before they merge: reads the diff, checks the tests, and says what would break."
        className={`${FIELD} resize-y`}
      />
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      {said && <p className="text-[12.5px] text-muted">{said}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:text-ink">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !what.trim()}
          onClick={() => void spawn()}
          className={BUTTON_PRIMARY}
        >
          {busy ? "Starting…" : "Start the thread"}
        </button>
      </div>
    </div>
  );
}
