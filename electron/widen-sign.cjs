// What main signs so a remote host lets a card widen (docs/architecture/project-hosts.md#signed-widening-as-built): a new
// folder, agent or read scope, skipping permission prompts, a "!" shell line, a terminal, a new thread with an agent.
// Board window only (the `handle` electron/pairing-ipc.cjs passes in), never the control server a thread can call.
// The Touch ID prompt is main's own words over exactly the fields it signs, so a board-side script can't show one
// change and have main sign another; the key is this Mac's desktop approval key (electron/desktop-signer.cjs).
//
// The endorsements that let this Mac's paired passkeys widen on a worker are electron/widen-endorse.cjs.
const crypto = require("node:crypto");

const WIDEN_V = "weft-widen-v1";
const VERBS = new Set(["card.update", "card.shell", "card.schedule", "terminal.open", "card.create", "settings.put", "tree.snapshot"]);
const CHANGE_KEYS = new Set(["cwd", "agent", "permissionMode", "readScope", "shell", "schedule", "terminal", "create", "goose", "wip"]);
// A worker's Goose provider and endpoint (settings.put): where a Goose card's traffic goes.
const GOOSE_KEYS = ["gooseProviderId", "gooseBaseUrl"];
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
const widenMessage = (f) => canonical({ v: WIDEN_V, host: f.host, card: f.card, verb: f.verb, change: f.change, args: f.args, nonce: f.nonce, issuedAt: f.issuedAt });

const strings = (v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

const plain = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** What the board asks main to sign, or a string saying why not. @returns {{ host: string, card: string, verb: string, change: Record<string, unknown>, args: Record<string, unknown> } | string} */
function readWidenRequest(raw) {
  if (!raw || typeof raw !== "object") return "Nothing to sign.";
  const { host, card, verb, change, args } = raw;
  if (typeof host !== "string" || !ID.test(host) || typeof card !== "string" || (card !== "" && !ID.test(card))) return "That approval names no host or card.";
  if (!VERBS.has(verb)) return "That isn't a change main signs.";
  if (!plain(change) || !Object.keys(change).length) return "That approval changes nothing.";
  if (Object.keys(change).some((k) => !CHANGE_KEYS.has(k))) return "That approval names a change main doesn't know.";
  return argsProblem(args) ?? changeProblem(change) ?? { host, card, verb, change, args };
}

// The rest of the command, bound whole (lib/widen.ts widenArgsOf, createTerms): the prompt names what's in it.
function argsProblem(args) {
  return !plain(args) || canonical(args).length > 20_000 || strings(args).some((s) => BIDI.test(s)) ? "That approval's command isn't one main signs." : null;
}

// What the prompt shows of each field, at most: main signs nothing it would have to cut or bend to show, so the words
// Touch ID asks over are the whole of what's signed (a long "!" line can't hide its tail past an ellipsis).
const SHOWN = { cwd: 120, readScope: 120, shell: 160, schedule: 160, terminal: 60, agent: 60 };
// Control and format characters: the prompt would show them as a space (a newline in a "!" line is a second command).
const HIDDEN = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

function shownProblem(value, max) {
  if (typeof value !== "string") return "That change isn't text main can show.";
  if (value.length > max) return "That change is too long to show in full in Touch ID. Make it on the Mac or the box itself.";
  return HIDDEN.test(value) ? "That change has characters Touch ID can't show, so main won't sign it." : null;
}

// Each field the type its host takes and short and plain enough to show whole; null when it all is.
function changeProblem(change) {
  if (strings(change).some((s) => BIDI.test(s))) return "That change has text-direction characters, so main won't sign it.";
  for (const [key, max] of Object.entries(SHOWN)) {
    if (change[key] === undefined || (key === "agent" && change[key] === null)) continue;
    const why = shownProblem(change[key], max);
    if (why) return why;
  }
  if (change.permissionMode !== undefined && change.permissionMode !== "bypassPermissions") return "That isn't a mode main signs.";
  if (change.goose !== undefined) return gooseProblem(change.goose);
  if (change.wip !== undefined) return wipProblem(change.wip);
  return change.create === undefined ? null : createProblem(change.create);
}

// Goose's provider and endpoint, each shown whole; "" clears one, so it may be empty.
function gooseProblem(g) {
  if (!plain(g) || !Object.keys(g).length || Object.keys(g).some((k) => !GOOSE_KEYS.includes(k))) return "That Goose change isn't one main signs.";
  for (const key of GOOSE_KEYS) {
    if (g[key] === undefined || g[key] === "") continue;
    const why = shownProblem(g[key], 120);
    if (why) return why;
  }
  return Object.values(g).every((v) => typeof v === "string") ? null : "That change isn't text main can show.";
}

// Another Mac's uncommitted work: the project, its GitHub repo and the Mac's name, each shown whole.
function wipProblem(w) {
  if (!plain(w) || Object.keys(w).some((k) => !["folder", "origin", "mac"].includes(k))) return "That request for uncommitted work isn't one main signs.";
  if (!w.folder || !w.origin) return "That request for uncommitted work names no project.";
  return shownProblem(w.folder, 60) ?? shownProblem(w.origin, 100) ?? (w.mac === undefined ? null : shownProblem(w.mac, 60));
}

// A new thread: its agent and folder shown, its first message signed as sent.
function createProblem(c) {
  if (!c || typeof c !== "object" || Array.isArray(c) || Object.keys(c).some((k) => !["agent", "folder", "prompt"].includes(k))) return "That new thread isn't one main signs.";
  // The first message isn't in the prompt (the network may start a thread with any message); the agent and folder are.
  return shownProblem(c.agent, 60) ?? shownProblem(c.folder, 60) ?? (typeof c.prompt === "string" ? null : "That new thread has no first message.");
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
  if (change.terminal !== undefined) parts.push(`open a full shell (a terminal) in ${oneLine(change.terminal, 60)}`);
  if (change.create) parts.push(`start a thread with the agent ${oneLine(change.create.agent, 60)} in ${oneLine(change.create.folder, 60)}`);
  if (change.goose) parts.push(gooseWords(change.goose));
  if (change.wip) parts.push(`have it send its uncommitted work in ${oneLine(change.wip.folder, 60)} to ${oneLine(change.wip.origin, 100)}`);
  return parts.join(", ");
}

// Main's copy of @weft/client's gooseWords: the provider and endpoint, "" read as the default.
function gooseWords(g) {
  const said = (v, none) => (v ? oneLine(v, 120) : none);
  const parts = [];
  if (g.gooseProviderId !== undefined) parts.push(`the provider ${said(g.gooseProviderId, "Goose's own")}`);
  if (g.gooseBaseUrl !== undefined) parts.push(`the endpoint ${said(g.gooseBaseUrl, "none")}`);
  return `point Goose at ${parts.join(" and ")}`;
}

const TERM_WORDS = { permissionMode: "mode", backend: "CLI", model: "model", repo: "repo", effort: "effort", title: "title" };

// What else the signed command carries, in words: a card.update's other fields, a "!" line's send-at time, a new
// thread's first message (cut, with its length) and its mode, CLI, model and repo.
function argsWords(verb, change, args) {
  if (verb === "settings.put") {
    const patch = plain(args.patch) ? args.patch : {};
    const others = Object.keys(patch).filter((k) => !GOOSE_KEYS.includes(k));
    return others.length ? ` (and its ${others.map((k) => `${oneLine(k, 30)} ${oneLine(canonical(patch[k]), 40)}`).join(", ")} with it)` : "";
  }
  if (verb === "card.update") {
    const body = plain(args.body) ? args.body : {};
    const others = Object.keys(body).filter((k) => !(k in change));
    const shown = (v) => oneLine(typeof v === "string" ? v : canonical(v), 60);
    return others.length ? ` (and its ${others.map((k) => `${oneLine(k, 30)} ${shown(body[k])}`).join(", ")} with it)` : "";
  }
  if (verb === "card.schedule") return Number.isFinite(args.at) ? ` to send at ${new Date(args.at).toLocaleString()}` : "";
  if (verb !== "card.create") return "";
  const terms = Object.entries(TERM_WORDS).filter(([k]) => typeof args[k] === "string").map(([k, word]) => `${word} ${oneLine(args[k], 40)}`);
  const prompt = String(change.create.prompt);
  const first = ` with the first message "${oneLine(prompt, 200)}"${prompt.length > 200 ? ` (${prompt.length} characters)` : ""}`;
  return `${first}${terms.length ? `, ${terms.join(", ")}` : ""}`;
}

/**
 * The Touch ID prompt for a widening. `hostName` names a worker this Mac pinned.
 * @param {{ host: string, card: string, verb: string, change: Record<string, any>, args?: Record<string, any> }} req
 * @param {string} self @param {(id: string) => string | null} [hostName]
 */
function widenPrompt(req, self, hostName = () => null) {
  if (req.verb === "tree.snapshot") {
    const w = req.change.wip ?? {};
    return `ask the Mac ${w.mac ? `${oneLine(w.mac, 60)} ` : ""}(${req.host.slice(0, 8)}) to send its uncommitted work in ${oneLine(w.folder, 60)} to ${oneLine(w.origin, 100)}`;
  }
  const name = req.host === self ? null : hostName(req.host);
  const where = req.host === self ? "this Mac" : name ? `the worker ${oneLine(name, 60)} (${req.host.slice(0, 8)})` : `the host ${req.host}`;
  const which = req.verb === "settings.put" ? "the settings" : req.card ? `card ${req.card.slice(0, 8)}` : "a new card";
  return `${changeWords(req.change)}${argsWords(req.verb, req.change, req.args ?? {})}, for ${which} on ${where}`;
}

/**
 * @param {(channel: string, fn: (...args: any[]) => unknown) => void} handle the board-only IPC handler
 * @param {{ signer: { sign: (m: string) => string }, macDevice: () => string, confirm: (reason: string) => Promise<boolean>,
 *   hostName?: (id: string) => string | null, onGoose?: (host: string, goose: Record<string, string>) => void, now?: () => number }} deps
 */
function registerWidenSign(handle, { signer, macDevice, confirm, hostName, onGoose = () => {}, now = Date.now }) {
  // A widening, after Touch ID in main's words. Null when Touch ID is refused.
  handle("approval:widen", async (raw) => {
    const req = readWidenRequest(raw);
    if (typeof req === "string") throw new Error(req);
    const device = macDevice();
    if (!(await confirm(widenPrompt(req, device, hostName)))) return null;
    const issuedAt = now();
    const nonce = crypto.randomBytes(18).toString("base64url");
    const sig = signer.sign(widenMessage({ ...req, nonce, issuedAt }));
    // The provider and endpoint a worker's Goose key may go to (electron/worker-goose-set.cjs), once Touch ID passed.
    if (req.verb === "settings.put" && req.change.goose) onGoose(req.host, req.change.goose);
    return { kind: "ed25519", device, issuedAt, nonce, sig };
  });
}

module.exports = { registerWidenSign, readWidenRequest, widenPrompt, widenMessage, canonical };
