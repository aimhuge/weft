// card.update: the PATCH body of one card (title, archive, marks, read scope, mode, agent, folder, column, place),
// applied in that order. The validation is here, not in the route, so every host refuses what the Mac refuses.
import { isAgent, storedAgent } from "../agents";
import { listAgents } from "../agent-store";
import { repointCard } from "../card-repoint";
import { resolveFolder } from "../folders";
import { asText, cleanTitle } from "../format";
import { withReadScope } from "../read-scope";
import { endSession, isBusy, setPermissionMode } from "../runner";
import { getCard, reorderCard, updateCard } from "../store";
import { rememberTags } from "../tag-store";
import { normalizeTags } from "../tags";
import { MODES, type Card, type PermissionMode } from "../types";
import { moveCard } from "./card-move";
import type { CardPatch, CardUpdateArgs } from "./calls";
import { requireCard } from "./types";

function validatePermissionMode(card: Card, value: unknown) {
  if (!MODES.includes(value as PermissionMode)) throw new Error("Unknown permission mode.");
  if (card.backend === "codex" && card.sessionId && value !== card.permissionMode) {
    throw new Error("Codex keeps its sandbox mode for the life of a session. Start a new Codex thread to change it.");
  }
  if (value === "bypassPermissions" && (card.role === "copilot" || card.backend === "puku")) {
    throw new Error("This thread can't skip permission prompts.");
  }
}

function setTitleAndArchive(card: Card, body: CardPatch) {
  if (body.title !== undefined) {
    const title = cleanTitle(asText(body.title));
    if (title) updateCard(card.id, { title, titleBy: "user" });
  }
  if (body.archived !== undefined) {
    if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
    updateCard(card.id, { archived: Boolean(body.archived) });
  }
}

// ★ (a starred card is never auto-archived) and tags. Tags you set stay yours: retitle stops picking them (lib/tags.ts).
// `broke: null` dismisses the card's "Broke Weft" mark (lib/crash-blame.ts).
function setMarks(id: string, body: CardPatch) {
  if (body.starred !== undefined) updateCard(id, { starred: Boolean(body.starred) });
  if (body.broke === null) updateCard(id, { broke: undefined });
  if (body.tags === undefined) return;
  if (!Array.isArray(body.tags)) throw new Error("Tags must be a list.");
  const tags = normalizeTags(body.tags.map((t) => asText(t)));
  updateCard(id, { tags, tagsBy: "user" });
  // New ones join the catalog (lib/tag-store.ts), so they stay listed.
  rememberTags(tags);
}

// Read-scope grant: the agent's question named a path outside the project, the user picked
// "Read from <path>". Persist it: the folder guard (lib/folder-guard.ts) reads it live, so the
// in-flight turn can use it right away, and the next session starts with it as additionalDirectories.
// No /add-dir follow-up: the SDK CLI refuses it ("isn't available in this environment"), and the
// empty turn it started let the after-turn update page replace the page the thread had shown.
// Then the mode: Claude and puku can switch modes mid-turn; Codex fixes its sandbox for the saved session.
function grantReadAndMode(card: Card, body: CardPatch) {
  if (body.readScope !== undefined) {
    if (typeof body.readScope !== "string" || !body.readScope) throw new Error("readScope must be a non-empty path.");
    if (card.role === "copilot") throw new Error("The copilot doesn't read from project folders.");
    updateCard(card.id, { readScope: withReadScope(card.readScope, body.readScope, card.cwd) });
  }
  if (body.permissionMode !== undefined) {
    validatePermissionMode(card, body.permissionMode);
    setPermissionMode(card.id, body.permissionMode);
  }
}

// Who the thread is (lib/agents.ts). Its CLI read the old soul as it started, so the CLI ends here and the next
// turn resumes the same conversation under the new one.
async function setAgent(card: Card, value: unknown) {
  const agents = listAgents();
  if (!isAgent(value, agents)) throw new Error("Unknown agent.");
  if (card.role === "copilot") throw new Error("The copilot picks a persona, not an agent.");
  const agent = storedAgent(value, agents);
  if (agent === card.agent) return;
  await repointCard(card, { agent }, "Stop the thread before switching its agent.", { isBusy, endSession });
}

// Re-points a thread whose folder moved or was renamed.
function setFolder(id: string, cwd: string | undefined) {
  if (cwd === undefined) return;
  if (isBusy(id)) throw new Error("Stop the thread before moving its folder.");
  updateCard(id, { cwd: resolveFolder(cwd), error: undefined });
}

// Reorder inside a column. We accept before only on its own (no other body fields
// required) so a drag can land its PATCH even when nothing else changed. The card's
// own column is reordered — other columns are left alone.
function reorder(id: string, body: CardPatch) {
  if (!("before" in body)) return;
  if (body.before !== null && typeof body.before !== "string") {
    throw new Error("before must be a card id or null.");
  }
  reorderCard(id, body.before ?? null);
}

export async function updateCardVerb({ id, body }: CardUpdateArgs): Promise<{ card: Card | undefined }> {
  const card = requireCard(id);
  setTitleAndArchive(card, body);
  setMarks(id, body);
  grantReadAndMode(card, body);
  if (body.agent !== undefined) await setAgent(card, body.agent);
  setFolder(id, body.cwd);
  if (body.column && body.column !== card.column) moveCard(card, body.column);
  reorder(id, body);
  return { card: getCard(id) };
}
