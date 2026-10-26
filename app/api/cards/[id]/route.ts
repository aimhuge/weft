import { isAgent, storedAgent } from "@/lib/agents";
import { listAgents } from "@/lib/agent-store";
import { firstMessage, messagesForMove, doneOverrides } from "@/lib/automations";
import { repointCard } from "@/lib/card-repoint";
import { resolveFolder } from "@/lib/folders";
import { asText, cleanTitle } from "@/lib/format";
import { elevated, fail, guard } from "@/lib/guard";
import { withReadScope } from "@/lib/read-scope";
import { archiveWhenIdle, endSession, isBusy, queueMessages, sendMessage, setPermissionMode } from "@/lib/runner";
import { dismissSession } from "@/lib/settings";
import { deleteCard, getCard, reorderCard, updateCard } from "@/lib/store";
import { rememberTags } from "@/lib/tag-store";
import { normalizeTags } from "@/lib/tags";
import { COLUMNS, MODES, type Card, type Column, type PermissionMode } from "@/lib/types";
import { dropWorktree } from "@/lib/worktree-pool";

type Ctx = { params: Promise<{ id: string }> };

// Running and Needs you follow the thread's live state, so they can't be set by hand.
const MANUAL: Column[] = ["backlog", "review", "done"];

function validatePermissionMode(card: Card, value: unknown) {
  if (!MODES.includes(value as PermissionMode)) throw new Error("Unknown permission mode.");
  if (card.backend === "codex" && card.sessionId && value !== card.permissionMode) {
    throw new Error("Codex keeps its sandbox mode for the life of a session. Start a new Codex thread to change it.");
  }
  if (value === "bypassPermissions" && (card.role === "copilot" || card.backend === "puku")) {
    throw new Error("This thread can't skip permission prompts.");
  }
}

// ★ (a starred card is never auto-archived) and tags. Tags you set stay yours: retitle stops picking them (lib/tags.ts).
// `broke: null` dismisses the card's "Broke Weft" mark (lib/crash-blame.ts).
function setMarks(id: string, body: { starred?: unknown; tags?: unknown; broke?: unknown }) {
  if (body.starred !== undefined) updateCard(id, { starred: Boolean(body.starred) });
  if (body.broke === null) updateCard(id, { broke: undefined });
  if (body.tags === undefined) return;
  if (!Array.isArray(body.tags)) throw new Error("Tags must be a list.");
  const tags = normalizeTags(body.tags.map((t) => asText(t)));
  updateCard(id, { tags, tagsBy: "user" });
  // New ones join the catalog (lib/tag-store.ts), so they stay listed.
  rememberTags(tags);
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

// Your drag to another column (Running only from Backlog; Needs you never by hand).
function moveCard(card: Card, column: Column) {
  if (!COLUMNS.some((c) => c.id === column)) throw new Error("Unknown column.");
  if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
  // A turn waiting on you can be parked in Backlog, Review or Done; answering it later runs it on.
  const waiting = Boolean(card.pending) && MANUAL.includes(column);
  if (isBusy(card.id) && !waiting) throw new Error("Stop the thread before moving it.");
  if (column === "running") {
    if (card.column !== "backlog") throw new Error("Reply in the thread to run it again.");
    sendMessage(card.id, firstMessage(card));
  } else if (MANUAL.includes(column)) {
    updateCard(card.id, { column });
    // /weft:done can run on a different model / effort than the card's own (lib/automations doneOverrides).
    // Snapshot the card's picks before queueing the move's messages, so the /weft:done turn uses the
    // override and any later turn on the card goes back to the originals (lib/runner restoreDoneOverride).
    if (column === "done") applyDoneOverride(card);
    // Your own move runs that column's automations (Settings), such as weft:done for Done.
    queueMessages(card.id, messagesForMove(card, column));
    // Done files the card away once its automations (weft:done) have run.
    if (column === "done") archiveWhenIdle(card.id);
    else updateCard(card.id, { archived: false });
  } else {
    throw new Error("Cards move to Needs you on their own.");
  }
}

// Snapshots the card's model and effort onto preDoneModel / preDoneEffort, then sets them to the
// override Settings chose for /weft:done. A no-op when the setting is empty or the card isn't Claude.
// The CLI moves too when the backup model lives on another one: an exhausted model hands the
// wrap-up to the backup rather than make it wait for a reset.
function applyDoneOverride(card: Card) {
  const overrides = doneOverrides(card);
  if (!overrides.model && !overrides.effort && !overrides.backend) return;
  updateCard(card.id, {
    preDoneModel: card.model,
    preDoneEffort: card.effort,
    ...(overrides.backend ? { preDoneBackend: card.backend } : {}),
    ...(overrides.model ? { model: overrides.model } : {}),
    ...(overrides.effort ? { effort: overrides.effort } : {}),
    ...(overrides.backend ? { backend: overrides.backend, sessionId: undefined } : {}),
  });
}

// A mode change or a read grant widens what the thread may do: only Weft's own window, not a thread's curl (lib/guard.ts).
function widens(req: Request, body: { permissionMode?: unknown; readScope?: unknown }): Response | null {
  return body.permissionMode !== undefined || body.readScope !== undefined ? elevated(req) : null;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const card = getCard(id);
    if (!card) return fail("No such card.", 404);
    const body = (await req.json()) as {
      column?: Column;
      title?: unknown;
      cwd?: string;
      archived?: unknown;
      starred?: unknown;
      tags?: unknown;
      broke?: null;
      permissionMode?: PermissionMode;
      agent?: unknown;
      // The user clicked "Read from <path>" on a question. The directory is added to the card's
      // read scope (Card.readScope) so the live session's folder guard allows it
      // and the next session starts with it as additionalDirectories.
      readScope?: unknown;
      // The backlog's drop-onto-card gesture: place this card before `before` (a sibling id)
      // in the card's own column, or at the end when null.
      before?: string | null;
    };

    const loose = widens(req, body);
    if (loose) return loose;

    if (body.title !== undefined) {
      const title = cleanTitle(asText(body.title));
      if (title) updateCard(id, { title, titleBy: "user" });
    }

    if (body.archived !== undefined) {
      if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
      updateCard(id, { archived: Boolean(body.archived) });
    }

    setMarks(id, body);

    // Read-scope grant: the agent's question named a path outside the project, the user picked
    // "Read from <path>". Persist it: the folder guard (lib/folder-guard.ts) reads it live, so the
    // in-flight turn can use it right away, and the next session starts with it as additionalDirectories.
    // No /add-dir follow-up: the SDK CLI refuses it ("isn't available in this environment"), and the
    // empty turn it started let the after-turn update page replace the page the thread had shown.
    if (body.readScope !== undefined) {
      if (typeof body.readScope !== "string" || !body.readScope) throw new Error("readScope must be a non-empty path.");
      if (card.role === "copilot") throw new Error("The copilot doesn't read from project folders.");
      updateCard(id, { readScope: withReadScope(card.readScope, body.readScope, card.cwd) });
    }

    // Claude and puku can switch modes mid-turn; Codex fixes its sandbox for the saved session.
    if (body.permissionMode !== undefined) {
      validatePermissionMode(card, body.permissionMode);
      setPermissionMode(id, body.permissionMode);
    }

    if (body.agent !== undefined) await setAgent(card, body.agent);

    // Re-points a thread whose folder moved or was renamed.
    if (body.cwd !== undefined) {
      if (isBusy(id)) throw new Error("Stop the thread before moving its folder.");
      updateCard(id, { cwd: resolveFolder(body.cwd), error: undefined });
    }

    if (body.column && body.column !== card.column) moveCard(card, body.column);

    // Reorder inside a column. We accept before only on its own (no other body fields
    // required) so a drag can land its PATCH even when nothing else changed. The card's
    // own column is reordered — other columns are left alone.
    if ("before" in body) {
      if (body.before !== null && typeof body.before !== "string") {
        throw new Error("before must be a card id or null.");
      }
      reorderCard(id, body.before ?? null);
    }

    return Response.json({ card: getCard(id) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    if (getCard(id)?.role === "copilot") return fail("The copilot can't be deleted. Start a new chat instead.");
    const card = getCard(id);
    await endSession(id);
    // A picked-up session stays deleted; the sync won't bring it back.
    if (card?.source === "claude-code" && card.sessionId) dismissSession(card.sessionId);
    deleteCard(id);
    // An isolated card's worktree goes with it; a branch with commits that never landed stays (lib/worktree-pool.ts).
    if (card?.worktree) void dropWorktree(card.worktree).catch(() => {});
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
