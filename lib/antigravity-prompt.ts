import { ANTIGRAVITY_DEFAULT_MODEL } from "./new-thread";
import { codexProjectInstructions } from "./puku-context";
import { skillIndex, skillInvocation } from "./skills";
import { weftSystemPrompt } from "./weft-prompts";
import type { Session } from "./runner-state";
import type { PermissionMode } from "./types";

// What an Antigravity thread is told, and how its card's settings become agy's (docs/architecture/antigravity.md).

/**
 * Weft's instructions for the thread, sent once as session/new's systemPrompt.append (an Antigravity extension to ACP,
 * advertised in its initialize). agy loads the folder's AGENTS.md and GEMINI.md itself, but no CLAUDE.md, so that one is
 * added here, without what AGENTS.md already imports. The skill index goes too: a /name becomes the skill's text.
 */
export function agySystemAppend(session: Session): string {
  const spec = session.spec;
  const parts = [weftSystemPrompt({ backend: "antigravity", copilot: spec.copilot, persona: spec.persona, agent: spec.agent, project: spec.project })];
  const project = codexProjectInstructions(spec.cwd);
  if (project) parts.push(`# Project instructions\nAntigravity doesn't load CLAUDE.md, so Weft puts the project's here. Treat it like AGENTS.md.\n\n${project}`);
  const skills = skillIndex(spec.cwd, { weft: true, off: spec.skillsOff });
  if (skills) parts.push(skills);
  return parts.filter(Boolean).join("\n\n");
}

/** The turn's prompt: the user's text, with a /name turned into the skill's own instructions. */
export function agyPrompt(session: Session, text: string): string {
  return skillInvocation(text, session.spec.cwd, { weft: true });
}

/**
 * agy's mode for the card's permission mode. agy asks Weft (session/request_permission) about what its mode doesn't
 * allow, and Weft answers for the card: Bypass answers yes itself (lib/antigravity-runner.ts), so it runs on
 * accept-edits, the mode that asks least without agy's own auto classifier.
 */
export function agyMode(mode: PermissionMode): string {
  if (mode === "acceptEdits" || mode === "bypassPermissions") return "accept-edits";
  if (mode === "auto") return "auto";
  return "default";
}

/** The model slug the card pins, or undefined for agy's own choice. */
export function agyModel(model: string | undefined): string | undefined {
  return model && model !== ANTIGRAVITY_DEFAULT_MODEL ? model : undefined;
}

export const ANTIGRAVITY_PROMPT_CODE = [agySystemAppend, agyPrompt, agyMode, agyModel];
