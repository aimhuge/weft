import { folderName } from "./format";
import type { IntakeResult } from "./project-intake";

// What the intake screen (components/IntakeDialog.tsx) says, and the prompt its "Set it up in a thread" button
// starts a card with: a self-contained list of what's left to do, by name, never a value.

export const INTAKE_CARD_TITLE = "🔐 Finish setting up secrets and webhooks";

/** Whether the screen has anything for the user to do (blanks, webhooks, keys to rotate), not just news. */
export function intakeHasWork(r: IntakeResult): boolean {
  return Boolean(r.details?.blanks.length || r.details?.hooks.length || r.tracked.length);
}

/** The prompt for the thread that finishes what the intake started. */
export function intakePrompt(folder: string, r: IntakeResult): string {
  const d = r.details;
  const lines = [`Weft just took in ${folderName(folder)} (${folder}) and left some setup for you to finish with me.`];
  if (d?.blanks.length) {
    lines.push(
      "",
      "These names are blanks in the 🔐 vault, waiting for a value:",
      ...d.blanks.map((b) => `- ${b.name} (from ${b.source})${b.hint ? `: ${b.hint}` : ""}`),
      "",
      "For each one: check the code that reads it still needs it (drop the blank if not), then open the provider's page in the browser pane and show me where to get the value. A value I'd make up myself (a signing or cron secret), generate and store with mcp__secrets__set_value. Never ask me to paste a value into the thread.",
    );
  }
  if (d?.hooks.length) {
    lines.push(
      "",
      "These webhook routes are blanks in 🪝, not registered with their provider yet:",
      ...d.hooks.map((h) => `- ${h.name}: ${h.target}${h.provider ? ` (signed by ${h.provider})` : ""}${h.events?.length ? `, events ${h.events.join(", ")}` : ""}`),
      "",
      "For each one: get a public URL with mcp__webhooks__relay, register it with the provider (its CLI, API or dashboard in the browser pane), then mcp__webhooks__mark_registered.",
    );
  }
  if (r.tracked.length) {
    lines.push(
      "",
      `${r.tracked.join(", ")} ${r.tracked.length > 1 ? "are" : "is"} committed to git, so the keys in it are in the history. Walk me through rotating each at its provider, keeping the new values in the vault, and untracking the file (git rm --cached, then .gitignore).`,
    );
  }
  lines.push("", "Work through them one at a time, keep a checklist page in the browser pane, and tell me what's still open at the end.");
  return lines.join("\n");
}
