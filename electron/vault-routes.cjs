// The control server's vault routes for threads that write (docs/architecture/secrets.md): blank names in
// (mcp__secrets__add_blank, mcp__secrets__ask_add) and a value the thread generated or got itself
// (mcp__secrets__set_value), and the project intake (electron/vault-intake.cjs). Names and what happened come back,
// never a value.
const { intakeVault, cleanBlanks } = require("./vault-intake.cjs");
const { auditOutbox, markAuditSynced } = require("./keychain-audit.cjs");

// Stores one value a thread made or got itself (a signing secret, new Stripe price ids): adds a name that isn't
// there, fills a blank, and overwrites a value only with replace (set_value's replace: true), so a thread can't
// overwrite one by accident. Touch ID every time through vault.confirm, never a thread's fill unlock: this is a
// write, and the prompt says which of the three it is, naming the environment. The one exception is a card whose
// grant names writes (electron/vault-grants.cjs): the user approved its writes up front. Even then an overwrite asks,
// since it destroys the value that was there.
async function fillBlank(vault, folder, name, environment, value, replace = false, card = "") {
  if (!value) throw new Error(`Give a value for ${name}.`);
  const { label, secrets } = await vault.names(folder);
  const entry = secrets.find((s) => s.name === name && s.environment === environment);
  const action = !entry ? "added" : entry.missing ? "set" : "replaced";
  if (action === "replaced" && !replace) return { filled: true, label };
  const reason = {
    added: `let a thread add ${name} (${label}, ${environment})`,
    set: `let a thread set ${name} (${label}, ${environment})`,
    replaced: `let a thread overwrite the ${environment} value of ${name} (${label}) with a new one`,
  }[action];
  const granted = action !== "replaced" && (await vault.writeGranted?.(card, folder));
  if (!granted && !(await vault.confirm(reason))) return { denied: true, label };
  await vault.setValue(folder, name, environment, value, { source: granted ? "a thread, under its grant" : "a thread", by: "thread" });
  return action === "set" ? { ok: true, label } : { ok: true, [action]: true, label };
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

module.exports = { vaultRoutes, fillBlank, askAdd };
