import type { Backend, Card, Effort } from "./types";
import type { HeldModifiers } from "./use-mod-held";
import { GOOSE_PROVIDERS } from "./goose-provider";

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
// Goose's models are not here: each provider serves its own ids (lib/goose-provider.ts).
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
  codex: [{ id: CODEX_DEFAULT_MODEL, label: "Codex’s configured model" }],
  // Goose's models come from the provider the user set up (lib/goose-provider.ts): each provider
  // serves its own ids, so a fixed list here would be wrong for all but one of them. This is the
  // one row every Goose menu has — the provider's own pick.
  goose: [{ id: GOOSE_DEFAULT_MODEL, label: "Your BYOK model" }],
};

// Every model id any CLI serves. The pickers offer them all — picking a model moves the
// thread's CLI to the one that serves it — so the routes that accept a model accept them
// all too. One set, built from MODELS: a CLI added here brings its models with it.
export const ALL_MODEL_IDS: Set<string> = new Set(
  (Object.keys(MODELS) as Backend[]).flatMap((b) => MODELS[b].map((m) => m.id)),
);

// A Goose model's value in a model picker: "goose:<id>". A Goose provider serves ids no list can know
// ("puku-ai-2.8" through a Puku key, a local Ollama tag), and one of them can be another CLI's id too,
// so the picker can't tell a Goose row from puku-cli's by the id alone. The prefix says "this runs on
// Goose"; bareModel() takes it off before the id reaches Goose (modelOn, resolveModel).
export const GOOSE_PREFIX = "goose:";

/** The picker value of a model id on Goose. */
export function gooseValue(id: string): string {
  return GOOSE_PREFIX + id;
}

/** Whether a picker value is a Goose model's ("goose:<id>", with an id). */
export function isGooseValue(value: string): boolean {
  return value.startsWith(GOOSE_PREFIX) && value.length > GOOSE_PREFIX.length;
}

/** The model id a picker value runs: the value itself, or a Goose value's id without its prefix. */
export function bareModel(value: string): string {
  return isGooseValue(value) ? value.slice(GOOSE_PREFIX.length) : value;
}

/** Whether a value is a model a picker can hand back: one of the CLIs' own ids, or any Goose model. */
export function isModelValue(value: string): boolean {
  return ALL_MODEL_IDS.has(value) || isGooseValue(value);
}

/**
 * The model a card runs on, from a picked value. A card's model is the id the CLI takes, so the
 * "goose:" prefix a picker uses to tell a Goose row from another CLI's same id comes off here.
 * The card's backend says which CLI it is, and that is what carries the distinction.
 */
export function cardModel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return bareModel(value);
}

// The CLI that serves a model id, or undefined for an id neither serves.
//
// A Goose model is recognised two ways: by the "goose:" prefix a picker gives it, and by the
// provider catalog (lib/goose-provider.ts), because each provider serves its own ids and the
// menu no longer holds a fixed list of them. The catalog is asked by its model ids, so a bare
// id like "anthropic/claude-opus-4.1" still resolves to Goose.
export function backendFor(model: string): Backend | undefined {
  if (model === CODEX_DEFAULT_MODEL) return undefined;
  if (isGooseValue(model)) return "goose";
  const own = (Object.keys(MODELS) as Backend[]).find((b) => MODELS[b].some((m) => m.id === model));
  if (own) return own;
  return GOOSE_PROVIDERS.some((p) => p.models.includes(model)) ? "goose" : undefined;
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
  if (saved === null) return NO_MODEL;
  // A Goose model the user named or configured is remembered as its picker value ("goose:<id>").
  if (backend === "goose" && isGooseValue(saved)) return saved;
  return MODELS[backend].some((m) => m.id === saved) ? saved : NO_MODEL;
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
  // A Goose picker value runs on Goose only, as its bare id.
  if (isGooseValue(model)) return backend === "goose" ? modelOn(backend, bareModel(model)) : undefined;
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
// own default) and for a model no CLI serves. A Goose picker value comes back as its bare id.
export function resolveModel(model: string): { backend: Backend; model: string } | undefined {
  if (!model || model === CODEX_DEFAULT_MODEL) return undefined;
  const backend = backendFor(model);
  if (!backend) return undefined;
  return { backend, model: bareModel(model) };
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
  const bare = bareModel(id).replace(/\[[^\]]*\]$/, "");
  return Object.values(MODELS).flat().find((m) => m.id === bare)?.label ?? bare.replace(/^claude-/, "");
}

// The model and effort a card runs on: its own picks, else what its CLI's init reported (lib/cli-defaults.ts).
export function runningOn(card: Pick<Card, "backend" | "model" | "effort" | "stats">): { model?: string; effort?: Effort } {
  return { model: modelOn(card.backend, card.model) ?? card.stats?.runsOn?.model, effort: card.effort ?? card.stats?.runsOn?.effort };
}
