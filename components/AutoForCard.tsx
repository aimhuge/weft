"use client";

import type { Card } from "@/lib/types";
import { BUTTON_SECONDARY_SMALL as SECONDARY } from "./button-styles";

// "Auto on this card", beside Allow on a Bash prompt the card's own mode raised: the card goes to Auto, where Claude
// Code's classifier lets safe commands through and stops risky ones (which still come to Needs you, with Allow once and
// retry: lib/classifier-denial.ts), and this command is allowed. Claude Code and puku only: Codex keeps its mode for the
// session. Prompts from Weft's own guards (an outside folder, a claim) aren't the mode's, so they don't offer it.
export function autoForCard(card: Card, answered: boolean, setMode: ((cardId: string, mode: "auto") => Promise<void>) | undefined, allow: () => void) {
  const pending = card.pending;
  const offered =
    setMode &&
    pending?.toolName === "Bash" &&
    pending.why?.category === "mode" &&
    (card.backend === "claude" || card.backend === "puku") &&
    (card.permissionMode === "default" || card.permissionMode === "acceptEdits");
  if (!offered) return undefined;
  const go = () => {
    void setMode(card.id, "auto").catch(() => {});
    allow();
  };
  return (
    <button key="auto" onClick={go} disabled={answered} className={SECONDARY} title="Switch this card to Auto mode: safe commands run without asking, risky ones still stop here. Allows this one too.">
      Auto on this card
    </button>
  );
}
