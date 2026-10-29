import { folderName } from "./format";
import type { IntakeResult } from "./project-intake";

// The card the intake screen's "Get it running" button (components/IntakeDialog.tsx) starts: install the project,
// get the keys its code reads that have no value yet, then start its dev server in the pane; webhooks wait for later.
// The intake screen's only other button is Later, so this prompt carries everything the intake left to do.

// The user approves once: a thread grant covers the dev server's secrets, runs and fills for an hour, but not writes
// (set_value) or sealing a webhook relay's secret, so the card avoids those (docs/architecture/secrets.md#thread-grants).
const TOUCH_ID_ONCE =
  "Ask for my fingerprint at most once: call mcp__secrets__request_access a single time, right before the first step that needs a vault value (usually starting the dev server), and never call mcp__secrets__set_value, mcp__secrets__push_to_vercel or mcp__webhooks__relay, which each ask again. Pasting into a mcp__secrets__ask_add box doesn't need it.";

export const runCardTitle = (folder: string) => `▶ Get ${folderName(folder)} running`;

/** The prompt for that card: self-contained, since the thread knows nothing else about the project. Names, never values. */
export function runPrompt(folder: string, r?: IntakeResult): string {
  const d = r?.details;
  const lines = [
    `Weft just took in ${folderName(folder)} (${folder}). Get it running on this Mac and show it to me.`,
    "",
    TOUCH_ID_ONCE,
    "",
    "1. Install its dependencies with the package manager its lockfile names (pnpm, yarn, bun or npm; uv, poetry or pip for Python), unless they're already installed.",
  ];
  if (d?.blanks.length) {
    lines.push(
      "2. These keys its code reads have no value yet; they're blanks in the 🔐 vault:",
      ...d.blanks.map((b) => `   - ${b.name} (from ${b.source})${b.hint ? `: ${b.hint}` : ""}`),
      "   Check each is still needed (remove the blank if not). A value I'd make up myself (a signing or cron secret), give me a command that makes one and ask for it the same way. For a key from a provider, open its page in the browser pane to show me where to get it, then call mcp__secrets__ask_add so I paste it into the input in this thread. Ask for the ones the dev server needs to start first; carry on with the rest while I get them.",
    );
  } else {
    lines.push("2. When it needs an env var or key that isn't in the 🔐 vault, call mcp__secrets__ask_add with its name and show me where to get it, instead of asking me to paste it in chat.");
  }
  lines.push(
    "3. Find how it runs in development from package.json scripts, the README, a Makefile or Procfile. If it isn't a web app, run its main command or tests instead and say what you found.",
    "4. Start the dev server with mcp__devservers__start, never Bash in the background, and open it in the browser pane.",
  );
  if (d?.hooks.length) {
    lines.push(
      "5. These webhook routes aren't registered with their provider yet:",
      ...d.hooks.map((h) => `   - ${h.name}: ${h.target}${h.provider ? ` (signed by ${h.provider})` : ""}${h.events?.length ? `, events ${h.events.join(", ")}` : ""}`),
      "   Leave them for later (registering through the relay asks for another Touch ID): list them at the end with where each gets registered.",
    );
  }
  if (r?.tracked.length) {
    lines.push(
      "",
      `${r.tracked.join(", ")} ${r.tracked.length > 1 ? "are" : "is"} committed to git, so the keys in it are in the history. After it runs, walk me through rotating each at its provider into the vault and untracking the file (git rm --cached, then .gitignore).`,
    );
  }
  lines.push("", "Don't change the project's code to make it start; tell me what's broken. End with the url, the start command and anything still blocking.");
  return lines.join("\n");
}
