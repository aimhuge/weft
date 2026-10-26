import { storedAgent } from "./agents";
import { firstMessage } from "./automations";
import { resolveFolder } from "./folders";
import { asText, cleanTitle, titleFromPrompt } from "./format";
import { effortFor, BACKEND_IDS } from "./new-thread";
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

const MODEL_ID = /^[\w.\-\[\]]{1,60}$/;

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

  const model = typeof body.model === "string" && MODEL_ID.test(body.model) ? body.model : undefined;

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
    ...marksFromBody(body),
    // Its own worktree, taken from the pool before its first turn (lib/worktree-start.ts).
    ...(body.isolated === true ? { isolated: true } : {}),
  });
  touchProject(cwd);
  return card;
}

// The card's tags and agent from the body. Tags given here are yours, so retitle won't pick others (lib/retitle.ts);
// new ones join the catalog. The agent is who the thread is (lib/agents.ts); an unknown name or Builder stores none.
function marksFromBody(body: Record<string, unknown>): Pick<Card, "tags" | "tagsBy" | "agent"> {
  const tags = Array.isArray(body.tags) ? normalizeTags(body.tags.map((t) => asText(t))) : [];
  rememberTags(tags);
  const agent = storedAgent(body.agent);
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
