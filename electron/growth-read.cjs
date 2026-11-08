// The growth read, in Electron main (docs/architecture/slack.md): the numbers the daily growth summary posts.
//
// Why it lives here and not in the server: the rows live in production Supabase and the key that reads them is
// the service-role key in the 🔐 vault — a value that must never reach a thread, and in the packaged app never
// reaches the server's environment either (the server inherits Electron's process.env, which holds no vault
// value). So the server asks main for the numbers and main answers with rows. The key stays in main.
//
// The read is a PostgREST GET of a Postgres function, run by app-read-core.cjs's runSupabase: GET, so the
// database keeps it a read, and the project URL is checked against Supabase's host rule before the key is
// read. The same rule the mini apps' reads use (lib/app-folder.ts), so one key can't be pointed elsewhere.
//
// Which vault holds the key: Weft's own repo's, since the growth numbers are Weft's own production data. A
// vault's id is its git remote (electron/vault-id.cjs), so "github:aimhuge/weft" is the same vault on every
// clone of Weft and on a teammate's Mac. A fork changes it: WEFT_VAULT_ID names the vault to read instead.

const { runSupabase } = require("./app-read-core.cjs");

// The key the growth read needs, and the only name that will do: the service-role key for Weft's own project.
const SECRET_NAME = "SUPABASE_SECRET_KEY";

// The vault the key is in: Weft's own repo's, unless WEFT_VAULT_ID says otherwise.
const DEFAULT_VAULT = { id: "github:aimhuge/weft", label: "aimhuge/weft" };

// The functions the growth read may call. A closed list, because the route is a way to reach the database with
// a service key: a function name that isn't here never reaches PostgREST, whatever the caller asks for.
const FUNCTIONS = new Set(["growth_overview", "growth_events"]);

// The vault the key is read from: the one the caller names, else Weft's own.
function vaultFor(folder) {
  const where = String(folder ?? "").trim();
  if (where) return { folder: where };
  const id = String(process.env.WEFT_VAULT_ID ?? "").trim();
  if (id) return { vault: { id, label: id.replace(/^github:/, "") } };
  return { vault: DEFAULT_VAULT };
}

/**
 * The route: the numbers for a growth function, read with the vault's service key.
 *
 * @param {() => any} getVault The vault, once it is ready.
 * @param {typeof globalThis.fetch} [fetchImpl] The fetch to use (a fake in a test).
 */
function growthRoutes(getVault, fetchImpl = globalThis.fetch) {
  const vault = () => {
    const v = getVault();
    if (!v) throw new Error("The secrets vault isn't ready yet.");
    return v;
  };
  return {
    // POST /growth/read: { fn, args, folder, environment } → the rows. The key never comes back.
    /** @param {{ fn?: unknown, args?: Record<string, unknown>, folder?: string, environment?: string }} body */
    "POST /growth/read": async ({ fn, args, folder, environment }) => {
      const name = String(fn ?? "").trim();
      if (!FUNCTIONS.has(name)) throw new Error(`Growth can't read ${JSON.stringify(fn)}.`);
      const env = String(environment || "production");
      // The key, from the vault, in main. valuesFor logs the read in the audit log; the value itself stays here.
      const where = vaultFor(folder);
      const { values, missing, label } = where.folder
        ? await vault().valuesFor(where.folder, [SECRET_NAME], env, { detail: "the growth read" })
        : await vault().valuesForVault(where.vault, [SECRET_NAME], env, { detail: "the growth read" });
      if (missing.length || !values[SECRET_NAME]) {
        throw new Error(`${SECRET_NAME} has no value in ${label} · ${env} yet.`);
      }
      const rows = await runSupabase({
        supabaseUrl: process.env.WEFT_SUPABASE_URL || "https://lqjyravglujyizyqypxq.supabase.co",
        fn: name,
        declaredArgs: args ?? {},
        pageArgs: {},
        values,
        fetch: fetchImpl,
      });
      return { rows };
    },
  };
}

module.exports = { growthRoutes, SECRET_NAME, FUNCTIONS, DEFAULT_VAULT, vaultFor };
