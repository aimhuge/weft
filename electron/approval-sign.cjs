// What main signs for the desktop board (electron/desktop-signer.cjs, `approval:sign` in electron/pairing-ipc.cjs). The
// board names a card, a pending request and a decision; everything the Touch ID prompt says comes from main's own read
// of the local server (`GET /api/cards`): the card's title, the waiting request's tool and what it runs. The renderer
// sends no text for the prompt, so a board-side script can't show "allow ls" over a request that runs something else.
// Main signs only for this Mac: a request it can't see waiting here (another host's card) is refused.
const { READ_HEADERS } = require("./server-read.cjs");

const GRANTS = new Set(["card", "always"]);
const id = (v) => (typeof v === "string" && v && v.length <= 200 && !/[\u0000-\u001f\u2028\u2029]/.test(v) ? v : null);

function answersProblem(answers) {
  if (answers == null) return null;
  return typeof answers !== "object" || Object.values(answers).some((v) => typeof v !== "string") ? "That approval's answers aren't text." : null;
}

/**
 * What the board asks main to sign, each field the type it must be, or a string saying why not. Any other field
 * (a label, a host) is dropped.
 * @returns {{ orgId: string, cardId: string, pendingId: string, allow: boolean, answers?: Record<string, string>, grant?: string } | string}
 */
function readSignRequest(raw) {
  if (!raw || typeof raw !== "object") return "Nothing to sign.";
  const { orgId, cardId, pendingId, allow, answers, grant } = raw;
  if (!id(orgId) || !id(cardId) || !id(pendingId) || typeof allow !== "boolean") return "That approval is missing its workspace, card, request or decision.";
  if (grant != null && !GRANTS.has(grant)) return "That approval names an unknown grant.";
  const why = answersProblem(answers);
  if (why) return why;
  return { orgId, cardId, pendingId, allow, ...(answers ? { answers } : {}), ...(grant ? { grant } : {}) };
}

// One line of prompt text: control and format characters out, whitespace collapsed, cut to `max`.
function oneLine(text, max) {
  const flat = String(text ?? "").replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// What a request runs, in a few words: its command, file, url or pattern, else its input as JSON.
function summary(input) {
  const i = input && typeof input === "object" ? input : {};
  const named = ["command", "file_path", "notebook_path", "url", "pattern", "path"].map((k) => i[k]).find((v) => typeof v === "string" && v);
  return oneLine(named ?? JSON.stringify(i), 120);
}

/** The Touch ID prompt, built from main's own copy of the card and its request. */
function signPrompt(card, pending, allow, grant) {
  const scope = grant === "always" ? " and always for its folder" : grant === "card" ? " and for this card's folder" : "";
  return `${allow ? "allow" : "deny"} ${oneLine(pending.toolName, 60)}: ${summary(pending.input)}${scope}, on "${oneLine(card.title || "Untitled", 60)}"`;
}

/**
 * The card and its waiting request as the local server has them, or a string saying why not.
 * @param {() => Promise<Array<{ id: string, title?: string, pending?: { id: string, toolName: string, input: unknown } | null }>>} cards
 */
async function waitingRequest(cards, req) {
  const card = (await cards()).find((c) => c.id === req.cardId);
  if (!card) return "That card isn't on this Mac, so this Mac can't sign for it.";
  if (!card.pending || card.pending.id !== req.pendingId) return "That request isn't waiting any more.";
  return { card, pending: card.pending };
}

// Main's read of the board's cards from its own server.
const serverCards = (getServer) => async () => {
  const server = getServer();
  if (!server?.url) throw new Error("Weft's server isn't up yet.");
  const { cards } = await (await fetch(`${server.url}/api/cards`, READ_HEADERS)).json();
  return Array.isArray(cards) ? cards : [];
};

module.exports = { readSignRequest, signPrompt, waitingRequest, serverCards };
