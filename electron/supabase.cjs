// Supabase's side of Electron main (docs/architecture/supabase.md): your Supabase access token, sealed by
// safeStorage (the Keychain) so threads never see it, the projects it can reach, and which one a folder is
// linked to. A link is `supabase/.temp/project-ref`, the file `supabase link` writes, so the Supabase CLI in a
// thread (`supabase db push`, `supabase gen types`) works on the right project without asking. A folder whose
// .mcp.json points the Supabase MCP server at a project counts as linked too. Like Vercel, it answers the board only.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { gitRemote, mustBeFolder, repoOf } = require("./vercel-project.cjs");
const { readToken, requireKeychain, writeToken } = require("./provider-token.cjs");

const API = "https://api.supabase.com";
const TOKEN_FILE = "supabase-token.json";
// What Supabase takes as a project ref: 20 lowercase letters.
const REF = /^[a-z]{20}$/;
// A region code (ap-southeast-1) and an organization slug, as the Management API takes them.
const REGION = /^[a-z]{2}-[a-z]+-\d$/;
const ORG = /^[\w-]+$/;
// Where a new project's database password goes in the vault: the variable the Supabase CLI reads.
const PASSWORD = "SUPABASE_DB_PASSWORD";

class SupabaseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const refFile = (folder) => path.join(folder, "supabase", ".temp", "project-ref");

// The folder's link: the Supabase CLI's project-ref, else the project_ref in .mcp.json's Supabase server url.
/** @returns {{ ref: string, source: "cli" | "mcp" } | null} */
function readLink(folder) {
  try {
    const ref = fs.readFileSync(refFile(folder), "utf8").trim();
    if (REF.test(ref)) return { ref, source: "cli" };
  } catch {}
  try {
    const { mcpServers = {} } = JSON.parse(fs.readFileSync(path.join(folder, ".mcp.json"), "utf8"));
    for (const server of Object.values(mcpServers)) {
      const url = typeof server?.url === "string" && server.url.startsWith("https://mcp.supabase.com") ? new URL(server.url) : null;
      const ref = url?.searchParams.get("project_ref");
      if (ref && REF.test(ref)) return { ref, source: "mcp" };
    }
  } catch {}
  return null;
}

// supabase/.temp/project-ref, as `supabase link` writes it, and .temp kept out of git, as `supabase init` does.
function writeLink(folder, ref) {
  fs.mkdirSync(path.dirname(refFile(folder)), { recursive: true });
  fs.writeFileSync(refFile(folder), ref);
  const ignore = path.join(folder, "supabase", ".gitignore");
  const text = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf8") : "";
  if (!/^\/?\.temp\/?$/m.test(text)) fs.writeFileSync(ignore, `${text}${text && !text.endsWith("\n") ? "\n" : ""}.temp\n`);
}

// The versions of the folder's migrations (supabase/migrations/<version>_<name>.sql), oldest first.
function localMigrations(folder) {
  try {
    return fs
      .readdirSync(path.join(folder, "supabase", "migrations"))
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort()
      .map((f) => ({ version: f.split("_")[0], name: f.replace(/^\d+_|\.sql$/g, "") }));
  } catch {
    return [];
  }
}

// A project as the drawer and the picker show it.
function projectRow(p, orgs) {
  const org = orgs.find((o) => o.id === p.organization_id);
  return { ref: p.ref ?? p.id, name: p.name, org: org?.name ?? p.organization_slug ?? p.organization_id ?? null, region: p.region ?? null, status: p.status ?? "UNKNOWN", createdAt: Date.parse(p.created_at ?? "") || 0 };
}

// The vault name for a new project's password: SUPABASE_DB_PASSWORD, or with the project's name after it when
// the folder's vault already keeps one (another project's, which a new one mustn't overwrite).
async function passwordName(vault, folder, project) {
  const { secrets } = await vault.names(folder);
  if (!secrets.some((s) => s.name === PASSWORD && s.environment === "development" && !s.missing)) return PASSWORD;
  return `${PASSWORD}_${project.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "NEW"}`;
}

function createSupabase({ dataDir, safeStorage, vault = null, fetch: fetchImpl = globalThis.fetch, remote = gitRemote, randomBytes = crypto.randomBytes }) {
  const tokenFile = path.join(dataDir, TOKEN_FILE);
  let orgs = null; // [{ id, slug, name }], cached for the session

  function token() {
    return readToken(tokenFile, safeStorage);
  }

  async function call(pathname, { auth = token(), method = "GET", body } = {}) {
    if (!auth) throw new SupabaseError(401, "Add a Supabase access token first.");
    const headers = { Authorization: `Bearer ${auth}`, ...(body ? { "Content-Type": "application/json" } : {}) };
    const res = await fetchImpl(new URL(pathname, API), { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) throw new SupabaseError(res.status, "Supabase turned the token down. Add a new one.");
    if (!res.ok) throw new SupabaseError(res.status, data?.message ?? `Supabase answered ${res.status}.`);
    return data;
  }

  async function organizations(auth) {
    if (!orgs || auth) {
      const list = await call("/v1/organizations", { auth });
      orgs = (Array.isArray(list) ? list : []).map((o) => ({ id: o.id ?? o.slug, slug: o.slug ?? o.id, name: o.name ?? o.slug ?? o.id }));
    }
    return orgs;
  }

  // A linked project, and its local migrations Supabase hasn't applied (null when it can't say). A migration
  // applied under another version (the MCP's apply_migration stamps its own) counts as applied, by name, and
  // lands in drift so the local file can be renamed to match.
  async function linkedStatus(link, local) {
    const project = projectRow(await call(`/v1/projects/${link.ref}`), await organizations());
    let pending = null;
    let drift = [];
    if (local.length) {
      try {
        const remote = (await call(`/v1/projects/${link.ref}/database/migrations`)).map((m) => ({ version: String(m.version), name: m.name }));
        const versions = new Set(remote.map((m) => m.version));
        const byName = new Map(remote.map((m) => [m.name, m.version]));
        const unmatched = local.filter((m) => !versions.has(m.version));
        drift = unmatched.filter((m) => byName.has(m.name)).map((m) => ({ name: m.name, local: m.version, remote: byName.get(m.name) }));
        pending = unmatched.filter((m) => !byName.has(m.name)).map((m) => m.name);
      } catch {}
    }
    return { ...project, source: link.source, url: `https://${link.ref}.supabase.co`, pending, drift };
  }

  return {
    // Whether a token is saved and which organizations it reaches, and each folder's GitHub repo, link and
    // migrations. A folder whose project can't be read keeps its link with an error, so you can still unlink it.
    /** @returns {Promise<import("../lib/supabase-view").SupabaseStatus>} */
    async status(folders) {
      const signedIn = fs.existsSync(tokenFile);
      let names = null;
      let error = null;
      if (signedIn) {
        try {
          names = (await organizations()).map((o) => o.name);
        } catch (err) {
          error = err.message;
        }
      }
      const rows = await Promise.all(
        folders.map(async (folder) => {
          const link = readLink(folder);
          const local = localMigrations(folder);
          const row = { folder, repo: await repoOf(folder, remote), migrations: local.length, link: null, error: null };
          if (!link) return row;
          row.link = { ref: link.ref, source: link.source, name: null };
          if (!names) return row;
          try {
            row.link = await linkedStatus(link, local);
          } catch (err) {
            row.error = err.message;
          }
          return row;
        }),
      );
      return { signedIn, orgs: names, error, folders: rows };
    },

    // Checks the token with Supabase before keeping it.
    async setToken(value) {
      const auth = String(value ?? "").trim();
      if (!auth) throw new Error("Paste an access token from supabase.com/dashboard/account/tokens.");
      requireKeychain(safeStorage);
      const list = await organizations(auth);
      writeToken(tokenFile, safeStorage, auth);
      return { orgs: list.map((o) => o.name) };
    },

    forgetToken() {
      fs.rmSync(tokenFile, { force: true });
      orgs = null;
      return { signedIn: false };
    },

    // Every project the token reaches, newest first.
    /** @returns {Promise<import("../lib/supabase-view").SupabaseProject[]>} */
    async projects() {
      const list = await call("/v1/projects");
      const known = await organizations();
      return (Array.isArray(list) ? list : []).map((p) => projectRow(p, known)).sort((a, b) => b.createdAt - a.createdAt);
    },

    // The organizations a new project can go in, for the picker's New project form.
    async orgs() {
      return (await organizations()).map((o) => ({ slug: o.slug, name: o.name }));
    },

    // Makes a Supabase project and links the folder to it. Its database password is made here and kept in the
    // folder's 🔐 vault; it never reaches the board. The project is still starting when this returns.
    async create(folder, { name, org, region }) {
      mustBeFolder(folder);
      const title = String(name ?? "").trim();
      if (!title) throw new Error("Name the project.");
      if (!ORG.test(org)) throw new Error("Pick an organization.");
      if (!REGION.test(region)) throw new Error(`${region} isn't a Supabase region.`);
      if (!vault) throw new Error("The 🔐 vault isn't running, so Weft has nowhere to keep the database password.");
      const secret = await passwordName(vault, folder, title);
      const password = randomBytes(24).toString("base64url");
      const body = { name: title, organization_slug: org, db_pass: password, region_selection: { type: "specific", code: region } };
      const project = await call("/v1/projects", { method: "POST", body });
      const ref = project.ref ?? project.id;
      if (REF.test(ref)) writeLink(folder, ref);
      try {
        await vault.setValue(folder, secret, "development", password);
      } catch (err) {
        throw new Error(`Made ${title} on Supabase, but the vault couldn't keep its database password (${err.message}). Reset it in the project's Database settings.`);
      }
      return { ref, name: project.name ?? title, secret };
    },

    // Writes supabase/.temp/project-ref for the folder, after checking the project is really there.
    async link(folder, ref) {
      mustBeFolder(folder);
      if (!REF.test(ref)) throw new Error(`${ref} isn't a Supabase project ref.`);
      const project = await call(`/v1/projects/${ref}`);
      writeLink(folder, ref);
      return { linked: true, name: project.name };
    },

    // Removes the CLI's link only; a link in .mcp.json is a checked-in file, left for you to change.
    unlink(folder) {
      fs.rmSync(refFile(folder), { force: true });
      return { linked: false };
    },

    // Wakes a paused project (free projects pause after a week without use).
    async restore(ref) {
      if (!REF.test(ref)) throw new Error(`${ref} isn't a Supabase project ref.`);
      await call(`/v1/projects/${ref}/restore`, { method: "POST" });
      return { restoring: true };
    },
  };
}

// The IPC handlers. isBoard(sender) says whether a message came from the board window.
function registerSupabase(ipcMain, { supabase, isBoard }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("Supabase only answers the board window.");
      return fn(...args);
    });
  handle("supabase:status", (folders) => supabase.status(Array.isArray(folders) ? folders.filter((f) => typeof f === "string") : []));
  handle("supabase:set-token", (value) => supabase.setToken(String(value ?? "")));
  handle("supabase:forget-token", () => supabase.forgetToken());
  handle("supabase:projects", () => supabase.projects());
  handle("supabase:orgs", () => supabase.orgs());
  handle("supabase:create", (folder, opts) => supabase.create(String(folder), { name: String(opts?.name ?? ""), org: String(opts?.org ?? ""), region: String(opts?.region ?? "") }));
  handle("supabase:link", (folder, ref) => supabase.link(String(folder), String(ref)));
  handle("supabase:unlink", (folder) => supabase.unlink(String(folder)));
  handle("supabase:restore", (ref) => supabase.restore(String(ref)));
}

// Wires Supabase into Electron main for the board window (board() is its webContents). vault keeps a new
// project's database password (electron/vault.cjs).
function setupSupabase({ ipcMain, dataDir, board, vault }) {
  const safeStorage = require("./keychain-audit.cjs").keychainFor("Supabase token");
  const supabase = createSupabase({ dataDir, safeStorage, vault });
  registerSupabase(ipcMain, { supabase, isBoard: (sender) => Boolean(sender) && sender === board() });
  return supabase;
}

module.exports = { setupSupabase, createSupabase, registerSupabase, readLink, writeLink, localMigrations, TOKEN_FILE };
