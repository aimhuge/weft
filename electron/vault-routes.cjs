// The control server's vault routes for threads that write (docs/architecture/secrets.md): blank names in
// (mcp__secrets__add_blank, mcp__secrets__ask_add) and a value the thread generated or got itself
// (mcp__secrets__set_value, or several with set_values), and the project intake (electron/vault-intake.cjs).
// Names and what happened come back, never a value.
const { intakeVault, cleanBlanks } = require("./vault-intake.cjs");
const { auditOutbox, markAuditSynced } = require("./keychain-audit.cjs");

// Stores one value a thread made or got itself (a signing secret, new Stripe price ids): adds a name that isn't
// there, fills a blank, and overwrites a value only with replace (set_value's replace: true), so a thread can't
// overwrite one by accident. Touch ID every time through vault.confirm, never a thread's fill unlock: this is a
// write, and the prompt says which of the three it is, naming the environment. The one exception is a card whose
// grant names writes (electron/vault-grants.cjs): the user approved its writes up front. Even then an overwrite asks,
// since it destroys the value that was there. who, for a Weft Worker's card, says so in the prompt, with note (the value's
// fingerprint) after it and a PRODUCTION warning (electron/worker-vault.cjs).
// The Touch ID prompt's words for a fill: which of the three it is, a PRODUCTION warning, then a worker's note last (the
// value's fingerprint and the card's title, which is the worker's word, so it never comes before what's being done).
function fillReason(action, by, name, label, environment, note, fromWorker) {
  const what = {
    added: `let ${by} add ${name} (${label}, ${environment})`,
    set: `let ${by} set ${name} (${label}, ${environment})`,
    replaced: `let ${by} overwrite the ${environment} value of ${name} (${label}) with a new one`,
  }[action];
  return what + (fromWorker && environment === "production" ? ". This is the PRODUCTION value" : "") + (note ? `. ${note}` : "");
}

async function fillBlank(vault, folder, name, environment, value, replace = false, card = "", who = "", note) {
  if (!value) throw new Error(`Give a value for ${name}.`);
  const { label, secrets } = await vault.names(folder);
  const entry = secrets.find((s) => s.name === name && s.environment === environment);
  const action = !entry ? "added" : entry.missing ? "set" : "replaced";
  if (action === "replaced" && !replace) return { filled: true, label };
  const by = ["a thread", who].filter(Boolean).join(" ");
  const reason = fillReason(action, by, name, label, environment, note, Boolean(who));
  const granted = action !== "replaced" && (await vault.writeGranted?.(card, folder));
  if (!granted && !(await vault.confirm(reason))) return { denied: true, label };
  await vault.setValue(folder, name, environment, value, { source: granted ? "a thread, under its grant" : by, by: "thread" });
  return action === "set" ? { ok: true, label } : { ok: true, [action]: true, label };
}

// Several values a thread made, stored after ONE Touch ID (mcp__secrets__set_values): the user asked for setup's
// writes to come as one question, not one per secret. Each entry is planned like fillBlank's (add, set, overwrite
// with replace, or skipped as filled without it), then a single vault.confirm names every write with its
// environment and says which overwrite. A card whose grant names writes skips the question unless the batch
// overwrites, as fillBlank does. Nothing is written unless the user says yes; values are never in the prompt.
const MAX_MANY = 20;
const named = (list) => list.map((e) => `${e.name} (${e.environment})`).join(", ");

function planMany(secrets, entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("Give at least one {name, value}.");
  if (entries.length > MAX_MANY) throw new Error(`At most ${MAX_MANY} secrets in one call.`);
  const seen = new Set();
  return entries.map((e) => {
    const name = String(e?.name ?? "").trim();
    if (!name) throw new Error("Every secret needs a name.");
    const environment = String(e.environment || "development");
    const value = String(e.value ?? "");
    if (!value) throw new Error(`Give a value for ${name}.`);
    if (seen.has(`${name}\n${environment}`)) throw new Error(`${name} (${environment}) is in the list twice.`);
    seen.add(`${name}\n${environment}`);
    const entry = secrets.find((s) => s.name === name && s.environment === environment);
    const action = !entry ? "added" : entry.missing ? "set" : e.replace === true ? "replaced" : "filled";
    return { name, environment, value, action };
  });
}

function manyReason(label, writes) {
  const of = (action) => writes.filter((w) => w.action === action);
  const parts = [
    of("added").length && `add ${named(of("added"))}`,
    of("set").length && `set ${named(of("set"))}`,
    of("replaced").length && `overwrite ${named(of("replaced"))} with new values`,
  ].filter(Boolean);
  return `let a thread store ${writes.length} secrets in ${label}: ${parts.join("; ")}`;
}

async function fillMany(vault, folder, entries, card = "") {
  const { label, secrets } = await vault.names(folder);
  const plan = planMany(secrets, entries);
  const pick = (list, action) => list.filter((w) => w.action === action).map(({ name, environment }) => ({ name, environment }));
  const filled = pick(plan, "filled");
  const writes = plan.filter((w) => w.action !== "filled");
  if (!writes.length) return { label, filled };
  // One write keeps fillBlank's own wording, so a batch of one reads as it always has.
  const one = writes.length === 1 && writes[0];
  const reason = one ? fillReason(one.action, "a thread", one.name, label, one.environment) : manyReason(label, writes);
  const granted = !writes.some((w) => w.action === "replaced") && (await vault.writeGranted?.(card, folder));
  if (!granted && !(await vault.confirm(reason))) return { denied: true, label, filled };
  const source = granted ? "a thread, under its grant" : "a thread";
  for (const w of writes) await vault.setValue(folder, w.name, w.environment, w.value, { source, by: "thread" });
  return { ok: true, label, added: pick(writes, "added"), set: pick(writes, "set"), replaced: pick(writes, "replaced"), filled };
}

// A key a thread is blocked on (mcp__secrets__ask_add), or one a fill or run found missing: the name goes in as a
// blank. A name that already has a value in that environment keeps it and the answer says so (filled), so the
// thread isn't told it's a blank when it isn't. Never fails: the thread still hears where to add it by hand.
async function askAdd(vault, folder, name, environment) {
  const r = await vault?.addBlanks(folder, [name], [environment], { source: "a thread" }).catch(() => null);
  if (r?.filled?.includes(name)) return { filled: true, label: r.label };
  return { added: true };
}

/**
 * The control server's routes for the vault (electron/browser-pane.cjs).
 * @param {() => any} getVault
 * @param {(body: Record<string, unknown>, route: string) => string} [cardFor] which card a request is for, proven
 */
function vaultRoutes(getVault, cardFor = () => "") {
  const vault = () => {
    const v = getVault();
    if (!v) throw new Error("The secrets vault isn't ready yet.");
    return v;
  };
  const env = (environment) => String(environment || "development");
  return {
    // Names with no value yet, for the user to fill in later (lib/secret-ask.ts). The rail's 🔐 count goes up; nothing opens.
    "POST /secrets/add-blank": ({ folder, names, environment, hint }) =>
      vault().addBlanks(String(folder), Array.isArray(names) ? names.map(String) : [], [env(environment)], { source: "a thread", hint: hint ? String(hint).slice(0, 400) : undefined }),
    "POST /secrets/set": (body, route) =>
      fillBlank(vault(), String(body.folder), String(body.name), env(body.environment), String(body.value ?? ""), body.replace === true, String(cardFor(body, route) || "")),
    // mcp__secrets__set_values: several at once, one Touch ID for the lot.
    "POST /secrets/set-many": (body, route) => fillMany(vault(), String(body.folder), body.secrets, String(cardFor(body, route) || "")),
    // The ask's input shows in the thread itself (components/SecretAskInput.tsx).
    "POST /secrets/ask-add": ({ folder, name, environment }) => askAdd(getVault(), String(folder), String(name), env(environment)),
    // A thread asking for standing access to the vault (mcp__secrets__request_access, electron/vault-grants.cjs):
    // the user's Touch ID names the card and its reason, and the card is asked nothing more for an hour.
    // A site, when the thread names one, is part of the grant's scope: a value may then be typed into
    // that page without asking again, and nowhere else (2026-10-28).
    "POST /secrets/request-access": (body, route) =>
      vault().grant(String(body.folder), {
        card: String(cardFor(body, route) || ""),
        thread: body.thread ? String(body.thread).slice(0, 120) : undefined,
        why: body.why ? String(body.why).slice(0, 200) : undefined,
        site: body.site ? String(body.site).slice(0, 200) : undefined,
        writes: body.writes === true,
        span: body.span === "thread" ? "thread" : "hour",
        by: "thread",
      }),
    // A card reached Done or was archived (lib/vault-grant-done.ts): its grants end with its work.
    "POST /secrets/revoke-card": (body, route) => {
      const card = String(cardFor(body, route) || "");
      return card ? vault().revoke(card, undefined, "weft") : { revoked: 0 };
    },
    // The audit log's lines not uploaded yet, and the cursor after an upload (lib/keychain-audit-sync.ts). Names and
    // events only: the log never holds a value.
    "POST /secrets/audit-outbox": ({ limit }) => ({ entries: auditOutbox(Number(limit) || undefined) }),
    "POST /secrets/audit-synced": ({ id }) => {
      if (id) markAuditSynced(String(id));
      return { ok: true };
    },
    // A project opened on the board (lib/project-intake.ts): untracked .env values in, the code's names as blanks.
    "POST /secrets/intake": ({ folder, blanks, skip }) =>
      intakeVault(vault(), String(folder), { blanks: cleanBlanks(blanks), skip: Array.isArray(skip) ? skip.map(String) : [] }),
  };
}

module.exports = { vaultRoutes, fillBlank, fillMany, askAdd };
