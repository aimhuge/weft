"use client";

// On your own card, when a teammate asks for it (Card.handoverAsk, lib/handover.ts): Hand it over stops the card, pushes
// the files it changed to a branch of their own (your working tree stays as it is) and tells their Mac, which starts
// their card from it; Not now tells them no. Either way the ask comes off the card.
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { Card, HandoverAsk } from "@/lib/types";

export async function answer(cardId: string, yes: boolean): Promise<{ branch?: string }> {
  const res = await apiFetch("/api/handover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ card: cardId, yes }) });
  const body = (await res.json().catch(() => ({}))) as { branch?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? "Couldn't answer that.");
  return body;
}

export default function HandoverAskBar({ card }: { card: Card & { handoverAsk: HandoverAsk } }) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const who = card.handoverAsk.name;
  async function go(yes: boolean) {
    setBusy(yes ? "yes" : "no");
    setError(null);
    try {
      const { branch } = await answer(card.id, yes);
      setSaid(yes ? `Handed over to ${who} on ${branch ?? "a branch"}.` : `Told ${who} not now.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }
  const button = "shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium disabled:opacity-60";
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-accent/40 bg-accent/5 px-4 py-2 text-[12.5px] text-muted">
      <p className="min-w-0 flex-1" role={error ? "alert" : undefined}>
        {error ?? said ?? `${who} asks to take this card over. Hand it over pushes the files it changed to a branch for them; your own files stay as they are.`}
      </p>
      {!said && (
        <>
          <button type="button" onClick={() => void go(true)} disabled={busy !== null} className={`${button} bg-accent text-on-accent hover:opacity-90`}>
            {busy === "yes" ? "Pushing…" : "Hand it over"}
          </button>
          <button type="button" onClick={() => void go(false)} disabled={busy !== null} className={`${button} border border-line text-ink hover:bg-sunken`}>
            Not now
          </button>
        </>
      )}
    </div>
  );
}
