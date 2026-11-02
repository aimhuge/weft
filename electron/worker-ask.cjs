// A Weft Worker's secret ask as main reads it off its device_calls row (electron/worker-secret.cjs). The row came off the
// network, so nothing in it is trusted: each field is checked and capped, the command is checked again with the same
// refusals the asking side used (electron/command-rules.cjs), and the command, script and folder may hold no control,
// format or bidi characters, so the window shows exactly what will run.
const { checkCommand, hasUnsafe, LOADER_VAR } = require("./command-rules.cjs");
const { parseRemote } = require("./vault-id.cjs");

const ENVIRONMENTS = ["development", "preview", "production"];
const NONCE = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// An ask further out than this wasn't made by lib/worker-secret-run.ts (5 minutes, with room for a slow clock).
const MAX_AHEAD_MS = 10 * 60_000;
const MAX_COMMAND = 4_000;
const MAX_SCRIPT = 8_000;
// Shown after the command, and only as the thread's word: capped so they can't push the command out of view.
const MAX_WHY = 300;
const MAX_THREAD = 120;

const str = (v, max) => (typeof v === "string" && v.length <= max ? v : undefined);
const capped = (v, max) => (typeof v === "string" && v.trim() ? (v.length > max ? `${v.slice(0, max - 1)}…` : v) : undefined);
const isNames = (v) => Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every((n) => typeof n === "string" && NAME.test(n));

// The ask's expiry, refused when it has passed or sits further out than an ask is made for.
function expiryOf(v, now) {
  const at = typeof v === "number" && Number.isFinite(v) ? v : 0;
  if (at <= now) throw new Error("That secret ask has expired.");
  if (at > now + MAX_AHEAD_MS) throw new Error("That secret ask's expiry is too far out.");
  return at;
}

// Text shown as is in the window: no characters that would show something other than what they are.
function plain(v, max, what, lines = false) {
  if (v === undefined || v === null) return undefined;
  const text = str(v, max);
  if (text === undefined || hasUnsafe(lines ? text.replace(/\n/g, "") : text)) throw new Error(`That secret ask's ${what} holds characters the approval can't show plainly.`);
  return text;
}

/**
 * @param {unknown} raw
 * @param {number} now
 */
function askOf(raw, now) {
  const a = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
  const command = str(a.command, MAX_COMMAND)?.trim();
  const environment = ENVIRONMENTS.find((e) => e === a.environment);
  const remote = str(a.remote, 500);
  const nonce = typeof a.nonce === "string" && NONCE.test(a.nonce) ? a.nonce : null;
  if (!nonce || !command || !isNames(a.names) || !environment || !remote) throw new Error("That secret ask isn't one Weft makes.");
  const names = /** @type {string[]} */ (a.names);
  if (names.some((n) => LOADER_VAR.test(n))) throw new Error("That secret ask puts a value in a variable that loads code (NODE_OPTIONS, LD_*, DYLD_*).");
  checkCommand(command, names);
  return {
    nonce,
    command,
    names,
    environment,
    remote: plain(remote, 500, "git remote"),
    expiresAt: expiryOf(a.expiresAt, now),
    cwd: plain(a.cwd ?? ".", 1_000, "folder") ?? ".",
    script: plain(a.script, MAX_SCRIPT, "script", true),
    why: capped(a.why, MAX_WHY),
    thread: capped(a.thread, MAX_THREAD),
    sig: typeof a.sig === "string" ? a.sig : undefined,
  };
}

// The vault a remote names, refused unless it is the GitHub repo (owner/name, as electron/vault-id.cjs normalises it) of
// the card's project as this Mac knows it (electron/worker-projects.cjs): a card in one project can't ask for another
// project's vault, and the worker's word for which project it is isn't enough.
/** @param {string} remote @param {string} folder @param {string[]} known the vault ids of this Mac's projects named folder */
function vaultFor(remote, folder, known) {
  const ref = parseRemote(remote);
  if (!ref || !ref.id.startsWith("github:")) throw new Error("That project's git remote doesn't name a GitHub repo's vault.");
  if (!known.length) throw new Error(`This Mac doesn't know which repo the worker's project "${folder}" is. Open that project on this Mac once (or send it to the worker from here), then try again.`);
  if (!known.includes(ref.id)) throw new Error(`The card's project "${folder}" is ${known.map((id) => id.slice("github:".length)).join(" or ")} on this Mac, but the ask names the vault of ${ref.label}. A card only gets its own project's secrets.`);
  return ref;
}

module.exports = { askOf, vaultFor, MAX_AHEAD_MS, MAX_WHY, MAX_THREAD };
