// The text and CLI args a Codex turn is started with: the prompt that goes on stdin and the argv
// the `codex exec` process runs with. lib/codex-runner.ts feeds them into driveCodex.

import { permissionArgs } from "./codex-permissions";
import { codexProjectInstructions } from "./puku-context";
import { subagentModelFor, subagentPrompt } from "./subagents";
import { CODEX_DEFAULT_MODEL } from "./new-thread";
import { threadPrompt } from "./settings";
import { skillIndex, skillInvocation } from "./skills";
import { getCard } from "./store";
import type { Session } from "./runner-state";

// Codex has no slash commands for skills, so `/name args` becomes the skill's own instructions.
function skillPrompt(text: string, cwd: string) {
  return skillInvocation(text, cwd, { weft: true });
}

export function promptFor(session: Session, text: string) {
  const weftInstructions = `You are a Codex CLI thread managed by Weft. Work in the card's project folder using Codex's native tools. Weft's tools (browser, board, secrets, webhooks, board_view) are MCP servers: call them as mcp__browser__open_url and so on. Never read .env files, credential stores or environment dumps. Never restart or kill Weft. Codex's sandbox enforces this card's permission mode.\n\n${subagentPrompt(subagentModelFor(), "codex")}\n\n${threadPrompt()}`;
  // Codex reads AGENTS.md on its own but not CLAUDE.md; a resumed session already has it in its history.
  const resumed = Boolean(session.sessionId ?? session.spec.sessionId);
  const claudeMd = resumed ? "" : codexProjectInstructions(session.spec.cwd);
  const skills = resumed ? "" : skillIndex(session.spec.cwd, { weft: true, off: session.spec.skillsOff });
  const project = claudeMd ? `Codex doesn't load CLAUDE.md, so Weft puts the project's here. Treat it like AGENTS.md.\n\n${claudeMd}\n\n` : "";
  const reminder = project || skills ? `<system-reminder>\n${project}${skills}\n</system-reminder>\n\n` : "";
  return `${reminder}${weftInstructions}\n\n${skillPrompt(text, session.spec.cwd)}`;
}

function modelArgs(model: string | undefined) {
  return model && model !== CODEX_DEFAULT_MODEL ? ["--model", model] : [];
}

function imageArgs(images: string[]) {
  return images.flatMap((image) => ["--image", image]);
}

// `mcp` is the `--config` pairs that point Codex at Weft's tools for this turn (lib/mcp-bridge.ts).
export function argsFor(session: Session, images: string[], mcp: string[] = []) {
  const card = session.cardId ? getCard(session.cardId) : undefined;
  const model = card?.model ?? session.spec.model;
  const sessionId = session.sessionId ?? session.spec.sessionId;
  if (sessionId) {
    // `exec resume` keeps the saved sandbox and reasoning effort; it only accepts a model override.
    return ["exec", "resume", "--json", ...mcp, ...modelArgs(model), ...imageArgs(images), sessionId, "-"];
  }

  const args = ["exec", "--json", "--cd", session.spec.cwd, "--skip-git-repo-check", ...mcp, ...modelArgs(model), ...imageArgs(images)];
  const effort = card?.effort ?? session.spec.effort;
  if (effort) args.push("--config", `model_reasoning_effort=${JSON.stringify(effort)}`);
  return [...args, ...permissionArgs(card?.permissionMode ?? session.spec.permissionMode), "-"];
}

// The code in this module, fed into the runner's BUILD fingerprint (lib/runner-session.ts) so a
// change to the prompt or argv invalidates idle sessions.
export const CODEX_PROMPT_CODE = [skillPrompt, promptFor, argsFor, modelArgs, imageArgs, permissionArgs];
