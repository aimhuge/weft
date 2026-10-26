import type { Backend, Card, Effort } from "./types";
import type { HeldModifiers } from "./use-mod-held";

// What the New thread dialog offers and remembers (components/NewCardDialog.tsx draws it).

export const LAST_CWD = "threadboard.cwd";
export const LAST_BACKEND = "threadboard.backend";
const LAST_MODEL = "weft.model";
const LAST_EFFORT = "weft.effort";
// What you were writing, kept if the dialog closes before the thread is created.
export const DRAFT = "weft.newThreadDraft";

export function remembered(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

// The remembered defaults live in localStorage, so a picker that changes one (Settings → Models,
// or another New thread dialog) has to tell the open dialogs to re-read them — a default you just
// changed has to take effect now, not the next time a dialog opens.
const defaultListeners = new Set<() => void>();

export function subscribeDefaults(listener: () => void) {
  defaultListeners.add(listener);
  return () => {
    defaultListeners.delete(listener);
  };
}

// Called after a remembered default changes.
export function defaultsChanged() {
  for (const listener of defaultListeners) listener();
}

export const BACKENDS: { id: Backend; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "puku", label: "puku-cli" },
  { id: "codex", label: "Codex" },
  { id: "goose", label: "Goose" },
];

// Every CLI Weft can start a thread on, as plain ids. The one list of them: a route that
// validates a backend, or a board tool that names one, checks against this — so a backend
// added to BACKENDS above works everywhere at once, instead of being quietly dropped
// (and the card starting on the default CLI) by a list that never heard of it.
export const BACKEND_IDS: Backend[] = BACKENDS.map((b) => b.id);

// Picker sentinel: Codex's own default model, so the runner omits `--model`.
export const CODEX_DEFAULT_MODEL = "codex-default";

// Picker sentinel: Goose's provider's own default model. Goose serves many providers, so
// this is "whatever the configured provider picks" rather than one fixed model.
export const GOOSE_DEFAULT_MODEL = "goose-default";

// The Puku gateway serves these three and answers any other id as puku-ai-2.8.
// Goose serves many providers, so its list is a starter set of OpenRouter-style ids.
export const MODELS: Record<Backend, { id: string; label: string }[]> = {
  claude: [
    { id: "claude-fable-5-1", label: "Fable 5.1" },
    { id: "claude-opus-5-5", label: "Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  ],
  puku: [
    { id: "opus-4.8", label: "Opus 4.8" },
    { id: "puku-ai-2.8", label: "Puku AI 2.8" },
    { id: "puku-ai-2.7", label: "Puku AI 2.7" },
  ],
  codex: [{ id: CODEX_DEFAULT_MODEL, label: "Let Codex choose" }],
  goose: [
    { id: GOOSE_DEFAULT_MODEL, label: "Let Goose choose" },
    { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5 (OpenRouter)" },
    { id: "anthropic/claude-opus-4.1", label: "Claude Opus 4.1 (OpenRouter)" },
    { id: "openai/gpt-4.1", label: "GPT-4.1 (OpenRouter)" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (OpenRouter)" },
    { id: "qwen/qwen3-coder", label: "Qwen3 Coder (OpenRouter)" },
  ],
};

// Every model id any CLI serves. The pickers offer them all — picking a model moves the
// thread's CLI to the one that serves it — so the routes that accept a model accept them
// all too. One set, built from MODELS: a CLI added here brings its models with it.
export const ALL_MODEL_IDS: Set<string> = new Set(
  (Object.keys(MODELS) as Backend[]).flatMap((b) => MODELS[b].map((m) => m.id)),
);

// The CLI that serves a model id, or undefined for an id neither serves.
export function backendFor(model: string): Backend | undefined {
  if (model === CODEX_DEFAULT_MODEL) return undefined;
  return (Object.keys(MODELS) as Backend[]).find((b) => MODELS[b].some((m) => m.id === model));
}

// The CLI that owns a model id when no list names it: Claude Code, the CLI every id is
// written for. An older Claude id ("claude-some-older") is still a Claude model.
const DEFAULT_OWNER: Backend = "claude";

// There is no default model: a model the user didn't pick is the CLI's own choice, and Weft leaves
// the model off the CLI's command line so the CLI picks. "" is that choice everywhere.
export const NO_MODEL = "";

// The last model picked for this CLI, or "" when the user never picked one (so the CLI's own
// default runs). The remembered pick is per CLI, so switching the CLI in the New thread dialog
// lands on the model you last picked for that CLI, or on its own default.
export function modelFor(backend: Backend): string {
  const saved = remembered(`${LAST_MODEL}.${backend}`);
  return saved !== null && MODELS[backend].some((m) => m.id === saved) ? saved : NO_MODEL;
}

// The model a card runs on this CLI: its own when the CLI serves it, else nothing (the CLI's own
// default). A Claude id on puku isn't refused — the gateway quietly answers it as puku-ai-2.8, so
// the chip would lie — so a model the CLI doesn't serve drops to undefined and the CLI decides.
// undefined stays undefined (the CLI's own default).
//
// Every model id belongs to exactly one CLI: the one whose list names it, or Claude Code for
// an id no list names (an older Claude id is still Claude's). A "[1m]"-style suffix is a cache
// hint on the same model, so it is stripped before the lookup and kept on the way out.
export function modelOn(backend: Backend, model: string | undefined): string | undefined {
  if (!model) return undefined;
  if (model === CODEX_DEFAULT_MODEL) return undefined;
  // Goose's own sentinel too: "goose-default" means the provider picks, so the card pins no model id.
  if (model === GOOSE_DEFAULT_MODEL) return undefined;
  // A Goose card takes any model id: Goose's providers are gateways that serve their own ids (a local
  // Ollama model, a private endpoint's), so no list can name them all and dropping one would silently
  // run a different model than the card asked for.
  if (backend === "goose") return model;
  const bare = model.replace(/\[[^\]]*\]$/, "");
  return (backendFor(bare) ?? DEFAULT_OWNER) === backend ? model : undefined;
}

// The CLI that serves a model, and the model as it should be sent to that CLI. Any model from any
// CLI can be picked anywhere; the CLI moves with the model. Returns undefined for "" (the CLI's
// own default) and for a model no CLI serves.
export function resolveModel(model: string): { backend: Backend; model: string } | undefined {
  if (!model || model === CODEX_DEFAULT_MODEL) return undefined;
  const backend = backendFor(model);
  if (!backend) return undefined;
  return { backend, model };
}

// "" leaves it to the model's own default. A new thread uses the last card's choice, High at first.
const DEFAULT_EFFORT: Effort = "high";
export const EFFORTS: { id: Effort | ""; label: string }[] = [
  { id: "", label: "Default effort" },
  { id: "low", label: "Low effort" },
  { id: "medium", label: "Medium effort" },
  { id: "high", label: "High effort" },
  { id: "xhigh", label: "Extra high effort" },
  { id: "max", label: "Max effort" },
];

// What each backend accepts. Puku-cli only takes low/medium/high/max — xhigh crashes it
// (puku-cli exits 1 with "option '--effort' argument 'xhigh' is invalid"). Goose has no
// effort flag at all, so it accepts none: effortFor drops every effort for it.
const EFFORT_BY_BACKEND: Record<Backend, Effort[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  puku: ["low", "medium", "high", "max"],
  codex: ["low", "medium", "high", "xhigh", "max"],
  goose: [],
};

// The closest effort a backend accepts. Drops xhigh to high for puku. "" / undefined pass through
// as undefined (use the model's own default). Use this everywhere a card's effort is sent to a
// CLI, not a hard-coded branch.
export function effortFor(backend: Backend, effort: Effort | "" | undefined): Effort | undefined {
  if (!effort) return undefined;
  const allowed = EFFORT_BY_BACKEND[backend];
  if (allowed.includes(effort)) return effort;
  // Closest fall-back by index: xhigh (4) → high (2) for puku.
  const claudeOrder: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  const idx = claudeOrder.indexOf(effort);
  if (idx === -1) return undefined;
  for (let i = idx; i >= 0; i--) {
    const candidate = claudeOrder[i];
    if (candidate && allowed.includes(candidate)) return candidate;
  }
  return undefined;
}

// Settings → Models sets what the next new thread starts on; the New thread dialog keeps its own last pick the same way.
export function setModelFor(backend: Backend, model: string) {
  remember(`${LAST_MODEL}.${backend}`, model);
  defaultsChanged();
}

export function setLastEffort(effort: Effort | "") {
  remember(LAST_EFFORT, effort);
  defaultsChanged();
}

// The last effort picked, High at first. Only the Claude CLI takes one.
export function lastEffort(): Effort | "" {
  const saved = remembered(LAST_EFFORT);
  return EFFORTS.find((e) => e.id === saved)?.id ?? DEFAULT_EFFORT;
}

// Keep the picks of a thread that was just made, for the next one. Effort is kept even when it's "",
// so picking Default effort sticks too.
export function rememberPicks(picks: { cwd: string; backend: Backend; model: string; effort: Effort | "" }) {
  remember(LAST_CWD, picks.cwd);
  remember(LAST_BACKEND, picks.backend);
  remember(`${LAST_MODEL}.${picks.backend}`, picks.model);
  remember(LAST_EFFORT, picks.effort);
  defaultsChanged();
}

// Why this prompt can't start yet, if it can't.
export function problemWith(prompt: string): string | null {
  return prompt ? null : "Write a prompt first.";
}

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// A prompt's first line without its Markdown heading marks, for naming the thread it started.
export function headline(prompt: string) {
  return (prompt.split("\n")[0] ?? "").replace(/^#+\s*/, "").slice(0, 60);
}

// The Start button's text and key cap: ⌃ names ⌃↵ (start, stay open), ⌘ names ⌘↵ (start, close).
export function startButton(held: HeldModifiers) {
  if (held.ctrl) return { label: "Start, keep open", key: "⌃↵" };
  if (held.mod) return { label: "Start & close", key: "⌘↵" };
  return { label: "Start now", key: "⌘" };
}

// A model id as the thread header shows it: "Fable 5.1" for one of ours, otherwise the id without "claude-" or a "[1m]" suffix.
export function modelLabel(id: string) {
  const bare = id.replace(/\[[^\]]*\]$/, "");
  return Object.values(MODELS).flat().find((m) => m.id === bare)?.label ?? bare.replace(/^claude-/, "");
}

// The model and effort a card runs on: its own picks, else what its CLI's init reported (lib/cli-defaults.ts).
export function runningOn(card: Pick<Card, "backend" | "model" | "effort" | "stats">): { model?: string; effort?: Effort } {
  return { model: modelOn(card.backend, card.model) ?? card.stats?.runsOn?.model, effort: card.effort ?? card.stats?.runsOn?.effort };
}
