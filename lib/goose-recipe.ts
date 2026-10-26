// What a Goose turn is started with: the prompt it gets, the system instructions it runs under, the argv it
// is started with, and the same plan as a Goose recipe (docs/architecture/goose.md).
//
// Goose's `run` takes one input: --text, --instructions or --recipe — the three are mutually exclusive
// (clap's conflicts_with), and --system is exclusive with --recipe too. So a turn that needs both a prompt
// and Weft's instructions has exactly one shape: --text for the prompt and --system for the instructions.
// The recipe is rendered too, and written beside the turn, because it is the same plan in Goose's own file
// format: it can be re-run by hand (`goose run --recipe turn.yaml`) or opened to see what the thread was told.
//
// Pure: no fs, no env, no globals. Everything it needs is passed in.

import { gooseAttributionPrompt } from "./attribution";
import { codexProjectInstructions } from "./puku-context";
import { skillIndex, skillInvocation } from "./skills";
import { GOOSE_DEFAULT_MODEL } from "./new-thread";
import { weftSystemPrompt } from "./weft-prompts";
import type { Backend, PermissionMode } from "./types";

// Goose's own guard against a runaway turn: how many model turns it may take without asking the user.
export const GOOSE_MAX_TURNS = 40;

// What a turn needs to know about the card it runs for.
export interface GooseTurnPlan {
  cwd: string;
  backend: Backend;
  copilot?: boolean;
  persona?: string;
  // The card's agent (lib/agents.ts), whose soul opens the system prompt.
  agent?: string;
  // The model the card runs on; undefined (or Goose's own default) means Goose picks.
  model?: string;
  // The permission mode the card runs in.
  permissionMode?: PermissionMode;
  // The skills this thread doesn't get (lib/skill-sets.ts).
  skillsOff?: string[];
  // The provider the card runs against (Goose's --provider). Empty means Goose's own choice.
  provider?: string;
}

// The provider id Goose is given: the one the card names, else empty (Goose picks its configured one).
export function gooseProviderFor(plan: GooseTurnPlan): string {
  return (plan.provider ?? "").trim();
}

// The model id Goose is given: the card's, unless it is Goose's own "let the CLI decide" sentinel.
export function gooseModelFor(plan: GooseTurnPlan): string {
  const model = (plan.model ?? "").trim();
  if (!model || model === GOOSE_DEFAULT_MODEL) return "";
  return model;
}

// The instructions a Goose turn runs under: Weft's own prompt for the card, plus the project's own
// instructions and skills, which Goose doesn't load on its own.
export function gooseSystemText(plan: GooseTurnPlan): string {
  const parts: string[] = [];
  const weft = weftSystemPrompt({ backend: plan.backend, copilot: plan.copilot, persona: plan.persona, agent: plan.agent });
  if (weft) parts.push(weft);
  // How its commits and PRs are signed: Claude Code gets this as a setting (lib/attribution.ts signAsWeft),
  // Goose has none, so it is told. The copilot does not commit.
  if (!plan.copilot) parts.push(gooseAttributionPrompt(gooseModelFor(plan) || undefined));
  // Goose reads the folder's own instructions and skills, but not a CLAUDE.md, so Weft puts that here.
  const project = codexProjectInstructions(plan.cwd);
  if (project) parts.push(`# Project instructions\n${project}`);
  const skills = skillIndex(plan.cwd, { weft: true, off: plan.skillsOff });
  if (skills) parts.push(skills);
  return parts.join("\n\n");
}

// The turn's prompt: the user's text, with a /name turned into the skill's own instructions (Goose has no
// slash commands for skills).
export function goosePrompt(plan: GooseTurnPlan, text: string): string {
  return skillInvocation(text, plan.cwd, { weft: true });
}

// The argv a `goose run` is started with. The working directory is not among them: Goose takes the
// session's folder from the process it runs in, so the runner spawns it with the card's folder as its cwd.
export function gooseArgs(plan: GooseTurnPlan, text: string): string[] {
  const args = ["run", "--output-format", "stream-json", "--max-turns", String(GOOSE_MAX_TURNS)];
  const provider = gooseProviderFor(plan);
  if (provider) args.push("--provider", provider);
  const model = gooseModelFor(plan);
  if (model) args.push("--model", model);
  const system = gooseSystemText(plan);
  if (system) args.push("--system", system);
  args.push("--text", goosePrompt(plan, text));
  return args;
}

// A YAML scalar: quoted, with the escapes YAML needs.
export function yamlString(value: string): string {
  return JSON.stringify(value);
}

// The turn's plan as a Goose recipe: the same prompt, instructions and settings in Goose's own file format.
// Weft runs the turn with --text and --system (the recipe is exclusive with both), and writes this beside the
// turn so the run can be repeated by hand or read to see what the thread was told.
export function gooseRecipeYaml(plan: GooseTurnPlan, text: string, title = "Weft thread"): string {
  const lines: string[] = [
    "title: " + yamlString(title),
    "description: " + yamlString("A Weft thread on the board."),
    "prompt: " + yamlString(goosePrompt(plan, text)),
  ];
  const system = gooseSystemText(plan);
  if (system) lines.push("instructions: " + yamlString(system));
  const provider = gooseProviderFor(plan);
  const model = gooseModelFor(plan);
  lines.push("settings:");
  if (provider) lines.push("  goose_provider: " + yamlString(provider));
  if (model) lines.push("  goose_model: " + yamlString(model));
  lines.push(`  max_turns: ${GOOSE_MAX_TURNS}`);
  lines.push("parameters: []");
  // No `response` block: Goose's validate_recipe.rs rejects an empty JSON schema and builder.rs
  // exits the process on an invalid one, so a recipe without a response block is the valid shape.
  return `${lines.join("\n")}\n`;
}

// The code in this module, fed into the runner's BUILD fingerprint (lib/runner-session.ts) so a change to
// the prompt or the argv replaces idle sessions.
export const GOOSE_RECIPE_CODE = [gooseProviderFor, gooseModelFor, gooseSystemText, goosePrompt, gooseArgs, yamlString, gooseRecipeYaml];
