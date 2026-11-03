// What main signs for the desktop board (electron/desktop-signer.cjs, `approval:sign`). The board names a card, a pending
// request and a decision; everything the Touch ID prompt says comes from main's own read of the local server: this
// Mac's cards (`GET /api/cards`), or a worker card's row as the worker published it (`GET /api/worker-board?ask=`,
// lib/worker-ask-read.ts): the card's title, the waiting request's tool and what it runs. The renderer sends no text for
// the prompt, so a board-side script can't show "allow ls" over a request that runs something else. The message's host
// and workspace come from that read too: this Mac's own id, or the worker's `worker:<id>` and its workspace, the names
// the worker rebuilds the message from (lib/worker-approve.ts). A request main can't see waiting is refused.
const { READ_HEADERS } = require("./server-read.cjs");
const { approvalMessage } = require("./desktop-signer.cjs");

const GRANTS = new Set(["card", "always"]);
const id = (v) => (typeof v === "string" && v && v.length <= 200 && !/[\u0000-\u001f\u2028\u2029]/.test(v) ? v : null);

function answersProblem(answers) {
  if (answers == null) return null;
  return typeof answers !== "object" || Object.values(answers).some((v) => typeof v !== "string") ? "That approval's answers aren't text." : null;
}

/**
 * What the board asks main to sign, each field the type it must be, or a string saying why not. Any other field
 * (a label, a host) is dropped.
 * @returns {{ orgId?: string, cardId: string, pendingId: string, allow: boolean, answers?: Record<string, string>, grant?: string } | string}
 */
function readSignRequest(raw) {
  if (!raw || typeof raw !== "object") return "Nothing to sign.";
  const { orgId, cardId, pendingId, allow, answers, grant } = raw;
  // The workspace is main's own read for a worker card; this Mac's card still names it.
  if ((orgId !== undefined && !id(orgId)) || !id(cardId) || !id(pendingId) || typeof allow !== "boolean") return "That approval is missing its workspace, card, request or decision.";
  if (grant != null && !GRANTS.has(grant)) return "That approval names an unknown grant.";
  const why = answersProblem(answers);
  if (why) return why;
  return { ...(orgId !== undefined ? { orgId } : {}), cardId, pendingId, allow, ...(answers ? { answers } : {}), ...(grant ? { grant } : {}) };
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

/** The Touch ID prompt, built from main's own copy of the card and its request; `where` names a worker. */
function signPrompt(card, pending, allow, grant, where) {
  const scope = grant === "always" ? " and always for its folder" : grant === "card" ? " and for this card's folder" : "";
  const host = where ? ` on ${oneLine(where, 80)}` : "";
  return `${allow ? "allow" : "deny"} ${oneLine(pending.toolName, 60)}: ${summary(pending.input)}${scope}, on "${oneLine(card.title || "Untitled", 60)}"${host}`;
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

const WORKER_DEVICE = /^worker:[A-Za-z0-9_-]{1,100}$/;

/**
 * The card, its waiting request and the names the message carries: this Mac's own card under its own id and the
 * workspace the board names, else a worker card under the worker's id and workspace as main read them. A string says
 * why not.
 * @param {{ cards: () => Promise<any[]>, workerAsk: (cardId: string) => Promise<any>, macDevice: () => string }} deps
 */
async function findRequest({ cards, workerAsk, macDevice }, req) {
  const here = (await cards()).some((c) => c.id === req.cardId);
  if (here) {
    if (!req.orgId) return "That approval is missing its workspace, card, request or decision.";
    const found = await waitingRequest(cards, req);
    return typeof found === "string" ? found : { ...found, orgId: req.orgId, device: macDevice(), worker: null };
  }
  const ask = await workerAsk(req.cardId).catch(() => null);
  if (!ask) return "That card isn't on this Mac or one of your workers, so this Mac can't sign for it.";
  if (!id(ask.orgId) || !WORKER_DEVICE.test(String(ask.device)) || ask.device !== `worker:${ask.workerId}`) return "That worker card's row doesn't say which worker runs it.";
  if (req.orgId !== undefined && req.orgId !== ask.orgId) return "That card is in another workspace.";
  const pending = ask.card?.pending;
  if (!pending || pending.id !== req.pendingId) return "That request isn't waiting any more.";
  return { card: ask.card, pending, orgId: ask.orgId, device: ask.device, worker: ask.workerId };
}

// Main's read of the board's cards from its own server.
const serverCards = (getServer) => async () => {
  const server = getServer();
  if (!server?.url) throw new Error("Weft's server isn't up yet.");
  const { cards } = await (await fetch(`${server.url}/api/cards`, READ_HEADERS)).json();
  return Array.isArray(cards) ? cards : [];
};

// Main's read of a worker card's row from its own server (lib/worker-ask-read.ts); null when it can't be read.
const serverWorkerAsk = (getServer) => async (cardId) => {
  const server = getServer();
  if (!server?.url) throw new Error("Weft's server isn't up yet.");
  const res = await fetch(`${server.url}/api/worker-board?ask=${encodeURIComponent(cardId)}`, READ_HEADERS);
  if (!res.ok) return null;
  return (await res.json()).ask ?? null;
};

/**
 * `approval:sign` on the board-only handler: main finds the request waiting (here or on a worker), asks Touch ID in its
 * own words, then signs the phone's message with this Mac's key. Null when Touch ID is refused.
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle
 * @param {{ cards: () => Promise<any[]>, workerAsk: (cardId: string) => Promise<any>, macDevice: () => string,
 *   confirm: (reason: string) => Promise<boolean>, signer: { sign: (m: string) => string, publicKey: () => string },
 *   sodium: () => any, workerName?: (id: string) => string | null, now?: () => number }} deps
 */
function registerApprovalSign(handle, { cards, workerAsk, macDevice, confirm, signer, sodium, workerName = () => null, now = Date.now }) {
  handle("approval:sign", async (raw) => {
    const req = readSignRequest(raw);
    if (typeof req === "string") throw new Error(req);
    const found = await findRequest({ cards, workerAsk, macDevice }, req);
    if (typeof found === "string") throw new Error(found);
    const name = found.worker ? workerName(found.worker) : null;
    const where = found.worker ? `the worker ${name ? `${name} ` : ""}(${found.worker.slice(0, 8)})` : undefined;
    if (!(await confirm(signPrompt(found.card, found.pending, req.allow, req.grant, where)))) return null;
    const issuedAt = now();
    const message = approvalMessage(sodium(), { ...req, orgId: found.orgId, macDevice: found.device, issuedAt });
    return { device: macDevice(), issuedAt, sig: signer.sign(message), publicKey: signer.publicKey() };
  });
}

module.exports = { readSignRequest, signPrompt, waitingRequest, findRequest, serverCards, serverWorkerAsk, registerApprovalSign };
