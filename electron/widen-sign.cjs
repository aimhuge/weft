// What main signs so a remote host lets a card widen (docs/architecture/project-hosts.md#signed-widening-as-built): a new
// folder, agent or read scope, skipping permission prompts, a "!" shell line, a terminal, a new thread with an agent.
// Board window only (the `handle` electron/pairing-ipc.cjs passes in), never the control server a thread can call.
// The Touch ID prompt is main's own words over exactly the fields it signs, so a board-side script can't show one
// change and have main sign another; the key is this Mac's desktop approval key (electron/desktop-signer.cjs).
//
// Also here: the endorsements that let this Mac's paired passkeys widen on a worker (a `pin` command; lib/host-signers.ts
// checks them on the box against this Mac's key, which the box pinned from the pairing code, H8).
const crypto = require("node:crypto");

const WIDEN_V = "weft-widen-v1";
const ENDORSE_V = "weft-endorse-v1";
const VERBS = new Set(["card.update", "card.shell", "card.schedule", "terminal.open", "card.create"]);
const CHANGE_KEYS = new Set(["cwd", "agent", "permissionMode", "readScope", "shell", "schedule", "terminal", "create"]);
const ID = /^[A-Za-z0-9_:.-]{1,200}$/;
// Bidi overrides and isolates: a host refuses them too (lib/widen-check.ts), and they could make the prompt lie.
const BIDI = /[\u202a-\u202e\u2066-\u2069]/;

// Main's copy of @weft/client's canonical JSON and widenMessage; electron/widen-sign.test.ts proves they agree.
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted(value[k])]));
  return value;
}
const canonical = (value) => JSON.stringify(sorted(JSON.parse(JSON.stringify(value ?? null))));
const widenMessage = (f) => canonical({ v: WIDEN_V, host: f.host, card: f.card, verb: f.verb, change: f.change, nonce: f.nonce, issuedAt: f.issuedAt });
const endorseMessage = (e) =>
  canonical({ v: ENDORSE_V, worker: e.worker, device: e.device, credId: e.credId, publicKey: e.publicKey, revoke: e.revoke, issuedAt: e.issuedAt });

const strings = (v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

/** What the board asks main to sign, or a string saying why not. @returns {{ host: string, card: string, verb: string, change: Record<string, unknown> } | string} */
function readWidenRequest(raw) {
  if (!raw || typeof raw !== "object") return "Nothing to sign.";
  const { host, card, verb, change } = raw;
  if (typeof host !== "string" || !ID.test(host) || typeof card !== "string" || (card !== "" && !ID.test(card))) return "That approval names no host or card.";
  if (!VERBS.has(verb)) return "That isn't a change main signs.";
  if (!change || typeof change !== "object" || Array.isArray(change) || !Object.keys(change).length) return "That approval changes nothing.";
  if (Object.keys(change).some((k) => !CHANGE_KEYS.has(k))) return "That approval names a change main doesn't know.";
  if (strings(change).some((s) => BIDI.test(s))) return "That change has text-direction characters, so main won't sign it.";
  return { host, card, verb, change };
}

// One line of prompt text: control and format characters out, whitespace collapsed, cut to `max`.
function oneLine(text, max) {
  const flat = String(text ?? "").replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// Main's copy of @weft/client's widenLabel, in a sentence for Touch ID.
function changeWords(change) {
  const parts = [];
  if (change.cwd !== undefined) parts.push(`move it to the folder ${oneLine(change.cwd, 120)}`);
  if (change.agent !== undefined) parts.push(change.agent ? `give it the agent ${oneLine(change.agent, 60)}` : "clear its agent");
  if (change.permissionMode) parts.push("let it skip permission prompts");
  if (change.readScope !== undefined) parts.push(`let it read from ${oneLine(change.readScope, 120)}`);
  if (change.shell !== undefined) parts.push(`run the shell command ${oneLine(change.shell, 160)}`);
  if (change.schedule !== undefined) parts.push(`schedule the shell line ${oneLine(change.schedule, 160)}`);
  if (change.terminal !== undefined) parts.push(`open a terminal in ${oneLine(change.terminal, 60)}`);
  if (change.create) parts.push(`start a thread with the agent ${oneLine(change.create.agent, 60)} in ${oneLine(change.create.folder, 60)}`);
  return parts.join(", ");
}

/** The Touch ID prompt for a widening. */
function widenPrompt(req, self) {
  const where = req.host === self ? "this Mac" : `the host ${req.host.slice(0, 8)}`;
  const which = req.card ? `card ${req.card.slice(0, 8)}` : "a new card";
  return `${changeWords(req.change)}, for ${which} on ${where}`;
}

/**
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle the board-only IPC handler
 * @param {{ signer: { sign: (m: string) => string }, macDevice: () => string, confirm: (reason: string) => Promise<boolean>,
 *   passkeys: () => Array<{ id: string, passkey?: { credId: string, publicKey: string } }>, now?: () => number }} deps
 */
function registerWidenSign(handle, { signer, macDevice, confirm, passkeys, now = Date.now }) {
  // A widening, after Touch ID in main's words. Null when Touch ID is refused.
  handle("approval:widen", async (raw) => {
    const req = readWidenRequest(raw);
    if (typeof req === "string") throw new Error(req);
    const device = macDevice();
    if (!(await confirm(widenPrompt(req, device)))) return null;
    const issuedAt = now();
    const nonce = crypto.randomBytes(18).toString("base64url");
    return { kind: "ed25519", device, issuedAt, nonce, sig: signer.sign(widenMessage({ ...req, nonce, issuedAt })) };
  });

  // Every passkey this Mac pinned, endorsed for one worker after one Touch ID; [] when there are none, null when refused.
  handle("approval:endorse", async (raw) => {
    const worker = raw && typeof raw === "object" ? raw.worker : undefined;
    const revoke = raw?.revoke === true;
    if (typeof worker !== "string" || !ID.test(worker)) throw new Error("That names no worker.");
    const keys = passkeys().filter((d) => d.passkey);
    if (!keys.length) return [];
    if (!(await confirm(`${revoke ? "stop letting" : "let"} your paired passkeys approve folder, agent, shell and terminal changes on the worker ${worker.slice(0, 8)}`))) return null;
    const mac = macDevice();
    return keys.map((d) => {
      const e = { worker, device: d.id, credId: d.passkey.credId, publicKey: d.passkey.publicKey, revoke, issuedAt: now() };
      return { ...e, mac, sig: signer.sign(endorseMessage(e)) };
    });
  });
}

module.exports = { registerWidenSign, readWidenRequest, widenPrompt, widenMessage, endorseMessage, canonical };
