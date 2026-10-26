import { createHash } from "node:crypto";
import { AGENT_SOULS, agentOf, WEFT_SOUL_PROMPT } from "./agents";
import { listAgents, savedAgentsHash } from "./agent-store";
import { COPILOT_PROMPT } from "./board-tools";
import { PERSONA_PROMPTS, personaOf } from "./copilot-personas";
import { BROWSER_PROMPT } from "./browser-tools";
import { ASK_BUTTONS_PROMPT, decisionsPrompt, MIGRATIONS_PROMPT } from "./decisions-prompt";
import { DEVSERVERS_PROMPT } from "./devserver-tools";
import { GOG_PROMPT } from "./gog";
import { RESTART_PROMPT } from "./env";
import { REVIEW_PROMPT } from "./review";
import { SECRETS_PROMPT } from "./secret-tools";
import { SIMULATOR_PROMPT } from "./simulator-tools";
import { DEFAULT_THREAD_PROMPT, threadPrompt } from "./settings";
import { CHOOSE, DELEGATE, subagentModelFor, subagentPrompt } from "./subagents";
import { WEBHOOKS_PROMPT } from "./webhook-tools";
import type { Backend } from "./types";

// Everything Weft adds to a thread's system prompt, in one place. The CLI reads its system prompt only
// when it starts, so the content of these strings counts toward the runner's build (lib/runner-session.ts
// currentBuild()): editing one replaces idle sessions instead of leaving them on the old text.

// The soul, the first part of the prompt, comes from the card's agent (lib/agents.ts); Builder's is Weft's own.
export { WEFT_SOUL_PROMPT };

export const WEFT_PINNED_PROMPTS = {
  WEFT_SOUL_PROMPT,
  AGENT_SOULS,
  BROWSER_PROMPT,
  COPILOT_PROMPT,
  COPILOT_PERSONA_PROMPTS: PERSONA_PROMPTS,
  SECRETS_PROMPT,
  WEBHOOKS_PROMPT,
  DEVSERVERS_PROMPT,
  GOG_PROMPT,
  SIMULATOR_PROMPT,
  MIGRATIONS_PROMPT,
  ASK_BUTTONS_PROMPT,
  RESTART_PROMPT,
  DEFAULT_THREAD_PROMPT,
  REVIEW_PROMPT,
  SUBAGENT_PROMPT: DELEGATE,
  SUBAGENT_CHOOSE_PROMPT: CHOOSE,
} as const;

const sha = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

// The pinned strings are constants, so their hash is taken once per load of this module.
const PINNED = sha(Object.entries(WEFT_PINNED_PROMPTS).map(([name, text]) => `${name}\n${text}`).join("\n\0\n"));

export function pinnedPromptsHash() {
  return PINNED;
}

// The pinned prompts plus the settings the prompt is built from (thread instructions, subagent model, the agents you
// saved in Settings → Agents).
// The subagent model is the resolved one, so a model that hits its limit invalidates the cached
// prompt and the thread's next turn names the backup model instead.
export function promptsBuild() {
  return `${PINNED}:${sha(`${threadPrompt()}\n${subagentModelFor()}\n${savedAgentsHash()}`)}`;
}

export type PromptSpec = { backend: Backend; copilot?: boolean; persona?: string; agent?: string; project?: string };

// An isolated card's thread (docs/architecture/worktrees.md): cwd is its own worktree, and Weft lands the branch on Done.
export const ISOLATED_PROMPT = `This card is isolated: your working directory is a git worktree of its own (under ~/.weft/worktrees), on its own branch (weft/* unless the user picked one), made from the project's HEAD or that branch. Other cards' half-done edits aren't here, and yours aren't in their folder. Work, test, typecheck and run the dev server here, never in the project folder itself. Commit on this branch as you go (by path or git add -A both fine here; reset and restore only touch your own work). Don't push and don't merge (in /weft:done, commit with commit.sh, then skip push.sh and deploy.mjs: pushing would publish your branch): when the card moves to Done, Weft commits what's left, rebases your branch on the project's branch and fast-forwards the project to it. If that rebase conflicts, Weft tells you which files; resolve them here and the next Done lands it.`;

const built = new Map<string, string>();

// Weft's part of the system prompt. Puku's gateway drops it, so a puku session sends it in its first message (lib/puku-context.ts).
export function weftSystemPrompt(spec: PromptSpec): string {
  const key = `${promptsBuild()}|${spec.copilot ? `copilot:${personaOf(spec.persona).id}` : `${spec.backend}:${agentOf(spec.agent, listAgents()).id}`}${spec.project ? "|isolated" : ""}`;
  const cached = built.get(key);
  if (cached !== undefined) return cached;
  const parts = spec.copilot
    ? [WEFT_SOUL_PROMPT, BROWSER_PROMPT, COPILOT_PROMPT, personaOf(spec.persona).prompt].filter(Boolean)
    : [agentOf(spec.agent, listAgents()).soul, BROWSER_PROMPT, SECRETS_PROMPT, WEBHOOKS_PROMPT, DEVSERVERS_PROMPT, GOG_PROMPT, SIMULATOR_PROMPT, decisionsPrompt(spec.backend), RESTART_PROMPT, subagentPrompt(subagentModelFor(), spec.backend), threadPrompt(), REVIEW_PROMPT, spec.project ? ISOLATED_PROMPT : ""].filter(Boolean);
  // A settings change makes a new key; the old prompts are of no further use.
  if (built.size >= 8) built.clear();
  const text = parts.join("\n\n");
  built.set(key, text);
  return text;
}
