import { storedAgent } from "./agents";
import { listAgents, projectAgent } from "./agent-store";
import { firstMessage } from "./automations";
import { validBranch } from "./branch-name";
import { resolveFolder } from "./folders";
import { asText, cleanTitle, titleFromPrompt } from "./format";
import { effortFor, BACKEND_IDS, GOOSE_PREFIX } from "./new-thread";
import { fallbackFor } from "./model-fallback";
import { sendMessage } from "./runner";
import { scheduleMessage } from "./scheduler";
import { defaultPermissionMode, touchProject } from "./settings";
import { startGate } from "./start-gate";
import { createCard } from "./store";
import { rememberTags } from "./tag-store";
import { normalizeTags } from "./tags";
import { MODES, type Backend, type Card, type Effort, type PermissionMode } from "./types";

// Making a card from a request body: POST /api/cards (the New thread dialog) and the cloud inbox (a card
// started on the weft.zip board, lib/cloud-inbox.ts) both go through here, so a card reads the same either way.

// Every CLI a card may run on. The list is shared (lib/new-thread.ts), so a CLI added there
// is startable here too — a card that named a CLI this list didn't know started on Claude
// instead, with nothing to say so.
const BACKENDS: Backend[] = BACKEND_IDS;

// The shape a model id has to have, so a body can't hand a card an arbitrary string to put on
// a CLI's command line. It is a shape check, not a list: a card's model can be any id a
// provider serves, and those use "/" ("anthropic/claude-opus-4.1"), ":" ("llama3:8b") and ":"
// ("host:port"), which a stricter pattern rejected. A rejected id became no model at all, so
// the card silently ran on the CLI's own default instead of the one that was asked for.
const MODEL_ID = /^[\w.:\-/[\]]{1,120}$/;

// The model a card runs, from a picker's value. A Goose model arrives as "goose:<id>" and the
// prefix comes off, because a card's model is the id the CLI takes.
function modelFromBody(body: Record<string, unknown>): string | undefined {
  const value = body.model;
  if (typeof value !== "string") return undefined;
  // A "goose:" prefix names a Goose model, so the prefix comes off. With no model after it there
  // is nothing to run, and the card takes its CLI's own choice.
  if (value.startsWith(GOOSE_PREFIX)) {
    const id = value.slice(GOOSE_PREFIX.length);
    return id && MODEL_ID.test(id) ? id : undefined;
  }
  if (!MODEL_ID.test(value)) return undefined;
  return value;
}

// Throws with a message to show when the body can't make a card (no prompt, a folder that isn't one).
export function createCardFromBody(body: Record<string, unknown>): Card {
  const prompt = asText(body.prompt).trim();
  if (!prompt) throw new Error("Write a prompt for this thread.");
  const typedTitle = cleanTitle(asText(body.title));
  const title = typedTitle || titleFromPrompt(prompt);

  const cwd = resolveFolder(body.cwd);

  const backend = BACKENDS.includes(body.backend as Backend) ? (body.backend as Backend) : "claude";
  const permissionMode = MODES.includes(body.permissionMode as PermissionMode)
    ? (body.permissionMode as PermissionMode)
    : defaultPermissionMode();

  const model = modelFromBody(body);

  // A model that has hit its limit is a bad place to start a thread: the first turn would fail on
  // it. The card starts on the backup model instead (lib/model-fallback.ts), and the CLI moves with
  // it when the backup lives on another one.
  const fallback = fallbackFor(model);
  const startBackend = fallback?.backend ?? backend;
  const startModel = fallback?.model ?? model;

  const effort = effortFor(startBackend, body.effort as Effort | "");

  const card = createCard({
    title,
    ...(typedTitle ? { titleBy: "user" as const } : {}),
    prompt,
    cwd,
    backend: startBackend,
    permissionMode,
    model: startModel,
    effort,
    ...marksFromBody(body, cwd),
    // Its own worktree, taken from the pool before its first turn (lib/worktree-start.ts).
    ...isolationFromBody(body),
  });
  touchProject(cwd);
  return card;
}

// Its own worktree, taken from the pool before its first turn (lib/worktree-start.ts), on the branch named when it
// names a valid one (an existing branch is checked out, a new name made from HEAD), else on its own weft/* branch.
function isolationFromBody(body: Record<string, unknown>): Pick<Card, "isolated" | "worktreeBranch"> {
  if (body.isolated !== true) return {};
  const branch = asText(body.branch).trim();
  return { isolated: true, ...(validBranch(branch) ? { worktreeBranch: branch } : {}) };
}

// The card's tags and agent from the body. Tags given here are yours, so retitle won't pick others (lib/retitle.ts);
// new ones join the catalog. The agent is who the thread is (lib/agents.ts): the one named, else the project's default
// (Settings → Agents); an unknown name or Builder stores none.
function marksFromBody(body: Record<string, unknown>, cwd: string): Pick<Card, "tags" | "tagsBy" | "agent"> {
  const tags = Array.isArray(body.tags) ? normalizeTags(body.tags.map((t) => asText(t))) : [];
  rememberTags(tags);
  const agent = storedAgent(body.agent ?? projectAgent(cwd), listAgents());
  return { ...(tags.length ? { tags, tagsBy: "user" as const } : {}), ...(agent ? { agent } : {}) };
}

// Sends the card's prompt (plus the skills a "thread starts" rule names) as its first turn.
//
// A card whose model or CLI is at its limit doesn't get that turn now: it would come straight back as
// a rate-limit error and the card would sit in Needs you, dead. Instead its first message waits for
// the window to reset (lib/start-gate.ts), and the scheduler sends it the moment it opens — a card
// that never ran is fine to schedule, the runner opens a session for it then (lib/runner.ts).
//
// Returns when the card's first turn goes out, or the time it waits for when it can't go yet.
export function startCard(card: Card): { started: boolean; at?: number } {
  const gate = startGate(card.backend, card.model);
  if (gate) {
    scheduleMessage(card.id, firstMessage(card), gate.at);
    return { started: false, at: gate.at };
  }
  sendMessage(card.id, firstMessage(card));
  return { started: true };
}
