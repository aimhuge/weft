// The control server's vault routes for threads that write (docs/architecture/secrets.md): blank names in
// (mcp__secrets__add_blank, mcp__secrets__ask_add) and a value the thread generated or got itself
// (mcp__secrets__set_value). Names and what happened come back, never a value.

// Stores one value a thread made or got itself (a signing secret, new Stripe price ids): adds a name that isn't
// there, fills a blank, and overwrites a value only with replace (set_value's replace: true), so a thread can't
// overwrite one by accident. Touch ID every time through vault.confirm, never a thread's fill unlock: this is a
// write, and the prompt says which of the three it is, naming the environment.
async function fillBlank(vault, folder, name, environment, value, replace = false) {
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
  if (!(await vault.confirm(reason))) return { denied: true, label };
  await vault.setValue(folder, name, environment, value, { source: "a thread" });
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

function vaultRoutes(getVault) {
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
    "POST /secrets/set": ({ folder, name, value, environment, replace }) =>
      fillBlank(vault(), String(folder), String(name), env(environment), String(value ?? ""), replace === true),
    // The ask's input shows in the thread itself (components/SecretAskInput.tsx).
    "POST /secrets/ask-add": ({ folder, name, environment }) => askAdd(getVault(), String(folder), String(name), env(environment)),
  };
}

module.exports = { vaultRoutes, fillBlank, askAdd };
