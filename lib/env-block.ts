// The <weft-env> block's tag, the line of thread instructions that explains it, and the strip every reader of a
// message uses (docs/architecture/thread-env.md). On its own, with no imports, so the transcript reader, the cloud rows
// and the test harness can take it without the runner's graph. lib/turn-env.ts builds the block.

export const ENV_TAG = "weft-env";

// One line of the thread's fixed instructions (lib/weft-prompts.ts, lib/codex-runner-prompt.ts).
export const ENV_PROMPT = `Weft starts each message it sends you with a block tagged ${ENV_TAG} that the user doesn't see: the host running this card (your Mac or a Weft Worker, its OS, Weft's version and commit, and whether it's behind origin/main), where the message came from (the desktop board, weft.zip, the phone app, a cron, another card) and the current time in the user's and the host's time zones. Trust it over your own guess for the time, the host and the client; don't echo it back unless asked.`;

// Only the block's own shape: the tag on a line of its own, a few lines with no markup, the closing tag. A prose
// mention of the tag (the prompt above, a user quoting it) never starts a match that runs to a real block's end.
const ENV_BLOCK = new RegExp(`<${ENV_TAG}>\\n(?:[^<\\n]*\\n){1,8}</${ENV_TAG}>\\n*`, "g");

/** Text with any <weft-env> block taken out, for anything that shows or shares a message. */
export function stripEnvBlock(text: string): string {
  return text.includes(`<${ENV_TAG}>`) ? text.replace(ENV_BLOCK, "") : text;
}
