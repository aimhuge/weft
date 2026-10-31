// Vault → Vercel env push (docs/architecture/vercel.md): which of a project's 🔐 secrets its linked Vercel project
// has, by name and environment, and pushing one across. The value goes from the vault to Vercel's API inside main
// (vault.sendValue, after a Touch ID that names the secret and the project; Push all asks once for the lot); the board and threads only ever see
// names. The drawer's Push button and mcp__secrets__push_to_vercel both land here. The other way, pull() brings
// down the plain variables the vault has no value for (by hand from the drawer, or on a Vercel webhook relayed by
// lib/vercel-hooks.ts); sensitive ones never decrypt, so they stay Vercel only. drift() lines the vault up against a
// cached list per folder (electron/vercel-env-cache.cjs), for the 🔐 and ▲ badges and the copilot's setup gaps.

const { createEnvCache } = require("./vercel-env-cache.cjs");
const { readLink } = require("./vercel-project.cjs");

const ENVIRONMENTS = ["development", "preview", "production"];
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Vercel types whose value its API hands back; "sensitive" and the old "secret" never do, "system" is Vercel's own.
const PULLABLE = new Set(["plain", "encrypted"]);

// One row per vault name and environment: whether it has a value here and whether Vercel has it there.
// Vercel-only names are listed too, so you can see what the vault doesn't hold.
/** @returns {import("../lib/vercel-view").VercelEnvStatus} */
function rowsOf({ label, secrets }, { project, envs }) {
  const onVercel = new Set(envs.flatMap((e) => e.targets.map((t) => `${t}\n${e.key}`)));
  const pullable = new Set(envs.filter((e) => PULLABLE.has(e.type)).flatMap((e) => e.targets.map((t) => `${t}\n${e.key}`)));
  const row = (name, environment, inVault) => {
    const key = `${environment}\n${name}`;
    return { name, environment, inVault, onVercel: onVercel.has(key), ...(!inVault && pullable.has(key) ? { pullable: true } : {}) };
  };
  const rows = secrets.map((s) => row(s.name, s.environment, !s.missing));
  const known = new Set(secrets.map((s) => `${s.environment}\n${s.name}`));
  for (const e of envs) for (const t of e.targets) if (ENVIRONMENTS.includes(t) && !known.has(`${t}\n${e.key}`)) rows.push(row(e.key, t, false));
  rows.sort((a, b) => ENVIRONMENTS.indexOf(a.environment) - ENVIRONMENTS.indexOf(b.environment) || a.name.localeCompare(b.name));
  return { label, project, rows };
}

/** @param {{ vercel: any, vault: any, onDrift?: (folder: string) => void, linked?: (folder: string) => boolean }} deps */
function createVercelEnv({ vercel, vault, onDrift, linked = (folder) => Boolean(readLink(folder)) }) {
  const cache = createEnvCache({ list: (folder) => vercel.envList(folder), linked, onChange: onDrift });
  return {
    async status(folder) {
      const [names, list] = await Promise.all([vault.names(folder), cache.listed(folder)]);
      return rowsOf(names, list);
    },

    // Every linked folder's rows from the cached list, against the vault as it is now; a folder with no list yet is
    // left out and fetched behind (onDrift says when it lands). Names only, like status.
    async drift(folders) {
      const out = [];
      for (const folder of folders) {
        const list = cache.peek(folder);
        if (!list) continue;
        const names = await vault.names(folder).catch(() => null);
        if (names) out.push({ folder, ...rowsOf(names, list) });
      }
      return out;
    },

    // Pushes one vault value to the linked project, replacing what Vercel had for that name and environment.
    // card is the thread that asked (mcp__secrets__push_to_vercel): its grant may cover the push.
    async push(folder, name, environment, card = "") {
      if (!NAME.test(name)) throw new Error(`${name || "A blank name"} isn't a variable name.`);
      if (!ENVIRONMENTS.includes(environment)) throw new Error(`Unknown environment: ${environment}`);
      const { project } = await vercel.envList(folder);
      const r = await vault.sendValue(folder, name, environment, (label) => `push ${name} (${label}, ${environment}) to Vercel project ${project}`, (value) => vercel.envSet(folder, name, environment, value), card);
      void cache.listed(folder).catch(() => null);
      return r;
    },

    // Push all: every value the vault holds for this folder, in every environment, behind one Touch ID that says how
    // many (vault.confirm, no unlock cache). Values stay in main; one Vercel refusal doesn't stop the rest.
    // only: just these names and environments (the drift's "2 missing on preview: push?"), else everything.
    async pushAll(folder, only) {
      const wanted = Array.isArray(only) ? new Set(only.map((o) => `${o.environment}\n${o.name}`)) : null;
      const { project } = await vercel.envList(folder);
      const found = [];
      let label = "";
      for (const environment of ENVIRONMENTS) {
        const r = await vault.valuesFor(folder, null, environment);
        label = r.label;
        for (const [name, value] of Object.entries(r.values)) if (!wanted || wanted.has(`${environment}\n${name}`)) found.push({ name, environment, value });
      }
      if (!found.length) return { label, project, sent: [], failed: [] };
      const n = found.length;
      if (!(await vault.confirm(`push ${n} ${n === 1 ? "secret" : "secrets"} (${label}) to Vercel project ${project}`))) return { label, project, denied: true };
      const sent = [];
      const failed = [];
      for (const { name, environment, value } of found) {
        try {
          await vercel.envSet(folder, name, environment, value);
          sent.push({ name, environment });
        } catch (err) {
          failed.push({ name, environment, error: err instanceof Error ? err.message : String(err) });
        }
      }
      void cache.listed(folder).catch(() => null);
      return { label, project, sent, failed };
    },

    // Brings down every plain Vercel variable the vault has no value for (absent, or a blank waiting for one), straight
    // into the vault inside main. A value the vault holds is never replaced: the vault stays the source of truth.
    // skipped: names Vercel has but won't decrypt (sensitive), so you know to add those by hand.
    async pull(folder) {
      const [{ label, secrets }, { project, envs }] = await Promise.all([vault.names(folder), vercel.envList(folder)]);
      const have = new Set(secrets.filter((s) => !s.missing).map((s) => `${s.environment}\n${s.name}`));
      const entries = [];
      const skipped = [];
      for (const e of envs) {
        const targets = e.targets.filter((t) => ENVIRONMENTS.includes(t) && !have.has(`${t}\n${e.key}`));
        if (!targets.length || !NAME.test(e.key)) continue;
        const value = PULLABLE.has(e.type) && e.id ? await vercel.envValue(folder, e.id) : null;
        for (const environment of targets) {
          have.add(`${environment}\n${e.key}`);
          if (value) entries.push({ name: e.key, environment, value });
          else skipped.push({ name: e.key, environment });
        }
      }
      for (const { name, environment, value } of entries) await vault.setValue(folder, name, environment, value, { source: "Vercel" });
      void cache.listed(folder).catch(() => null);
      return { label, project, pulled: entries.map(({ name, environment }) => ({ name, environment })), skipped };
    },

    // A team webhook for the env-variable events, and taking it off (lib/vercel-hooks.ts, through the control server).
    createWebhook: (teamId, url) => vercel.createWebhook(teamId, url),
    deleteWebhook: (teamId, id) => vercel.deleteWebhook(teamId, id),
  };
}

// The control server's routes for threads (mcp__secrets__push_to_vercel): names in, what happened out, never a value.
// cardFor proves which card asked (electron/card-token.cjs), so its grant can cover a push.
/** @param {(body: Record<string, unknown>, route: string) => string} [cardFor] */
function envRoutes(env, cardFor = () => "") {
  return {
    "POST /vercel/env-status": ({ folder }) => env().status(String(folder)),
    // The copilot's setup gaps (lib/copilot-setup.ts): cached rows only, so it never waits on Vercel.
    "POST /vercel/env-drift": ({ folders }) => env().drift(Array.isArray(folders) ? folders.map(String) : []),
    "POST /vercel/env-push": (body, route) => env().push(String(body.folder), String(body.name), String(body.environment ?? ""), String(cardFor(body, route) || "")),
    // The server's side of the pull webhook (lib/vercel-hooks.ts): pull a folder, and make or take off the team's hook.
    "POST /vercel/env-pull": ({ folder }) => env().pull(String(folder)),
    "POST /vercel/webhook-create": ({ teamId, url }) => env().createWebhook(String(teamId), String(url)),
    "POST /vercel/webhook-delete": ({ teamId, id }) => env().deleteWebhook(String(teamId), String(id)),
  };
}

module.exports = { createVercelEnv, envRoutes, rowsOf, ENVIRONMENTS, PULLABLE };
