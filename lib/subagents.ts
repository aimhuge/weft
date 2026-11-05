import { backendFor, bareModel, cardModel, MODELS } from "./new-thread";
import { fallbackFor } from "./model-fallback";
import { subagentModel, gooseNamedModels } from "./settings";
import { BACKEND_SHORT, type Backend } from "./types";
import type { SubagentModel } from "./types-settings";

// Subagents: when a board thread should hand work to a subagent, and on which model. The user picks in
// Settings ("Use … for subagents") from every model either CLI serves; "choose" leaves it to the thread,
// with a short guide, and "inherit" runs them on the thread's own model.
// - A model the thread's own CLI serves is forced through that CLI's env: Claude Code's
//   CLAUDE_CODE_SUBAGENT_MODEL plus _FORCE (which drops the Agent tool's model input and agent
//   definitions' models), puku-cli's PUKU_CLI_SUBAGENT_MODEL (which always wins).
// - The other CLI's model can't run behind the Agent tool, so the thread runs that CLI headless
//   (`claude -p` or `puku-cli -p`) with Bash instead, told how in its prompt.

// "choose", "inherit", or a model id from MODELS (lib/new-thread.ts); isSubagentModel checks one.
// The type itself lives in lib/types-settings.ts, so the types graph the client imports doesn't
// reach this module (and the settings file it reads) — see the note there.
export type { SubagentModel };

const COMMAND: Record<Backend, string> = { claude: "claude", puku: "puku-cli", codex: "codex", goose: "goose" };

// The CLI that serves a model id, or undefined for "choose", "inherit" and ids neither serves.
export const subagentBackend = backendFor;

// The model subagents should run on right now: the user's pick, unless that model has hit its
// limit, in which case the backup model takes over (lib/model-fallback.ts). "choose" and "inherit"
// pass through — neither names a model that could be exhausted.
//
// The id is the bare one: a pick is a picker value, and a Goose row's carries a "goose:" prefix
// that tells it from another CLI's same id. The prefix is the picker's business — here the id
// goes into a command line (`--model`) and a label, so it comes off.
export function subagentModelFor(now = Date.now()): SubagentModel {
  const picked = subagentModel();
  if (picked === "choose" || picked === "inherit") return picked;
  return cardModel(fallbackFor(picked, now)?.model ?? picked) ?? picked;
}

export function isSubagentModel(value: unknown): value is SubagentModel {
  return value === "choose" || value === "inherit" || (typeof value === "string" && subagentBackend(value) !== undefined);
}

export function subagentLabel(model: SubagentModel): string {
  if (model === "choose") return "Let the model choose";
  if (model === "inherit") return "Same model as the thread";
  // A pick may still carry the "goose:" prefix (the picker hands it back), so the id is read bare.
  const id = bareModel(model);
  const backend = subagentBackend(id);
  if (!backend) return model;
  // A model the user named shows its name; one of our own shows its label; a Goose model shows its
  // id, because each provider serves its own ids and there is no fixed list to name them from.
  const label = gooseNamedModels().find((m) => m.id === id)?.name ?? MODELS[backend].find((m) => m.id === id)?.label;
  return `${label ?? id} (${BACKEND_SHORT[backend]})`;
}

export const DELEGATE = `Use subagents (the Agent tool) more than you'd think: their file reads and long outputs stay out of this thread's context, and several run at once. Delegate when answering means reading across many files (the Explore agent), when the task splits into independent pieces (send them in one message so they run in parallel), for a test, lint or typecheck run where you only need the failures, and for a second-opinion review of a change you made. Do a single known lookup (one file, one grep) yourself. Give each subagent a self-contained prompt that says what to report back, and relay what matters: the user doesn't see its report.`;

export const CHOOSE = `Pick each subagent's model with the Agent tool's model input:
- haiku: searches, file lookups, summarizing logs or test output, mechanical edits from a precise spec. Fast and cheap; the default for read-only fan-out.
- sonnet: most coding work: a well-scoped change, writing tests, a code review, research that needs judgment.
- opus: hard reasoning where a mistake is costly: architecture, subtle bugs, security review, a plan others will build from.
When unsure, pick sonnet.`;

// Goose has no Agent tool, so a Goose thread's subagents are headless Goose runs from Bash.
export const GOOSE_DELEGATE = `Use subagents more than you'd think: their file reads and long outputs stay out of this thread's context, and several run at once. You have no Agent tool, so a subagent is a headless CLI run from Bash (below). Delegate when answering means reading across many files, when the task splits into independent pieces (start them in one message so they run in parallel), for a test, lint or typecheck run where you only need the failures, and for a second-opinion review of a change you made. Do a single known lookup (one file, one grep) yourself. Give each subagent a self-contained prompt that says what to report back, and relay what matters: the user doesn't see its report.`;

// How a thread runs a subagent headless from Bash, on another CLI's model or (for a Goose thread) on Goose
// itself: a run whose stdout is the report. Each CLI's headless shape is its own: Claude Code and puku-cli
// take a prompt flag and a model flag, Goose takes `run --text` with the model behind a provider. A Goose
// run with no model inherits the thread's provider and model from GOOSE_PROVIDER and GOOSE_MODEL
// (lib/goose-runner.ts gooseEnv). A Goose thread has no Agent tool to fall back on.
function crossCli(model: string | undefined, backend: Backend, thread: Backend = "claude"): string {
  const fallback = thread === "goose" ? "do the work yourself" : "use the Agent tool";
  const reach = thread === "goose" ? "" : ", which the Agent tool can't reach from this CLI";
  // The id that goes on the command line is the bare one: a pick may carry the "goose:" prefix,
  // and "goose run --model goose:<id>" is not a model any CLI serves.
  const id = model ? bareModel(model) : undefined;
  const why = model ? `Subagents run on ${subagentLabel(model)} (the user's Weft setting)${reach}.` : "Subagents run on the same provider and model as this thread.";
  const tail = `Several Bash calls in one message run in parallel; use run_in_background for long ones. If it fails because ${COMMAND[backend]} isn't installed or logged in, say so and ${fallback}.`;
  if (backend === "goose") {
    const cmd = `${COMMAND[backend]} run --text "<self-contained task>"${id ? ` --model ${id}` : ""}`;
    return `${why} Run each one with Bash:
${cmd}
Its output is the subagent's report. ${tail}`;
  }
  const cmd = `${COMMAND[backend]} -p "<self-contained task>" --model ${id} --allowedTools "Read Grep Glob" --permission-mode dontAsk`;
  return `${why} Run each one with Bash instead:
${cmd}
Its output is the subagent's report. Add Edit and Write to --allowedTools for a subagent that changes files. ${tail}`;
}

// A Goose thread's prompt: the Agent tool's guide doesn't apply, so every choice is a Bash run. A model
// Goose serves (or none, for "choose" and "inherit") is a `goose run`; another CLI's model is that CLI's.
function goosePrompt(model: SubagentModel): string {
  const serves = model === "choose" || model === "inherit" ? undefined : subagentBackend(model);
  const run = serves && serves !== "goose" ? crossCli(model, serves, "goose") : crossCli(serves ? model : undefined, "goose", "goose");
  return `${GOOSE_DELEGATE}\n\n${run}`;
}

export function subagentPrompt(model: SubagentModel, backend: Backend): string {
  if (backend === "goose") return goosePrompt(model);
  if (model === "choose") return backend === "claude" ? `${DELEGATE}\n\n${CHOOSE}` : DELEGATE;
  if (model === "inherit") return `${DELEGATE}\n\nSubagents run on the same model as this thread (the user's Weft setting), so leave the Agent tool's model input out.`;
  const serves = subagentBackend(model);
  if (serves && serves !== backend) return `${DELEGATE}\n\n${crossCli(model, serves)}`;
  return `${DELEGATE}\n\nSubagents run on ${subagentLabel(model)} (the user's Weft setting), so leave the Agent tool's model input out.`;
}

// puku-cli refuses a subagent model outside its pinned list ("[pinnedModels] Refusing to persist
// non-pinned model 'opus-4.8'"), and its list names the Opus tier "opus", not "opus-4.8".
const PUKU_PINNED = ["puku-ai-2.7", "puku-ai-2.8"];
export function pukuSubagentModel(model: string): string {
  return PUKU_PINNED.includes(model) ? model : "opus";
}

// puku-cli's subagents inherit the thread's model when it's unset, so "inherit" needs nothing there.
// Goose has no subagent-model env var at all (it has no Agent tool), so it gets none: naming
// Claude Code's variable there would set a knob the CLI doesn't read.
export function subagentEnv(model: SubagentModel, backend: Backend): Record<string, string> {
  if (model === "choose") return {};
  if (model === "inherit") return backend === "claude" ? { CLAUDE_CODE_SUBAGENT_MODEL: "inherit", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" } : {};
  if (subagentBackend(model) !== backend) return {};
  if (backend === "claude") return { CLAUDE_CODE_SUBAGENT_MODEL: model, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" };
  if (backend === "puku") return { PUKU_CLI_SUBAGENT_MODEL: pukuSubagentModel(model) };
  return {};
}
