// BlastCP's side of Electron main (docs/architecture/blastcp.md): your BlastCP sign-in, sealed by
// safeStorage (the Keychain) so threads never see it, and which property each board folder posts as.
// Every read goes through BlastCP's MCP endpoint (one JSON-RPC tools/call per request), the same tools
// a thread's BlastCP connector uses. Links live in Weft's data folder, not the repo. Board window only.
const fs = require("node:fs");
const path = require("node:path");
const { ORIGIN, WEFT_CLIENT, exchangeWeft, signIn } = require("./blastcp-oauth.cjs");
const { readTokenRecord, requireKeychain, writeToken } = require("./provider-token.cjs");

const TOKEN_FILE = "blastcp-token.json";
const LINKS_FILE = "blastcp-links.json";
// { off: true } after Disconnect, so connecting with your Weft account doesn't bring it straight back.
const AUTO_FILE = "blastcp-auto.json";
// A sign-in Weft made from your Weft account is swapped for a fresh one in its last week.
const RENEW_MS = 7 * 24 * 60 * 60_000;
// The newest posts a linked folder lists; the queue and the counts come from these.
const POSTS = 100;

class BlastcpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// get_started's "Workspaces:" lines, the only place BlastCP names a workspace's properties:
//   - Alex Miller (alex): 3 connected channels; properties (pass one as property_slug): alex = Alex Miller, weft = Weft
//   - Side (side): 0 connected channels; no properties yet
/** @returns {import("../lib/blastcp-view").BlastcpWorkspace[]} */
function parseWorkspaces(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = /^- (.*) \(([a-z0-9][a-z0-9-]*)\): (.*)$/.exec(line.trim());
    if (!m) continue;
    const props = /properties \(pass one as property_slug\): (.+)$/.exec(m[3]);
    const properties = props
      ? props[1].split(/, (?=[a-z0-9][a-z0-9-]* = )/).flatMap((p) => {
          const entry = /^([a-z0-9][a-z0-9-]*)(?:\s*=\s*(.*))?$/.exec(p.trim());
          return entry ? [{ slug: entry[1], name: entry[2]?.trim() || entry[1] }] : [];
        })
      : [];
    out.push({ slug: m[2], name: m[1], properties });
  }
  return out;
}

// One list_posts row, in the board's words.
/** @returns {import("../lib/blastcp-view").BlastcpPost} */
function postOf(p) {
  return {
    id: String(p.id),
    platform: String(p.platform ?? ""),
    status: String(p.status ?? ""),
    title: p.title || p.link_title || p.link_url || null,
    scheduledFor: p.scheduled_for ? Date.parse(p.scheduled_for) : null,
    publishedAt: p.published_at ? Date.parse(p.published_at) : null,
    url: p.external_url ?? null,
    reviewUrl: p.review_url ?? null,
  };
}

// A tool result's first text block; a tool that failed throws its text.
function textOf(result) {
  const text = (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text)[0] ?? "";
  if (result?.isError) throw new BlastcpError(400, text || "BlastCP couldn't do that.");
  return text;
}

const propertyUrl = (org, property) => `${ORIGIN}/${encodeURIComponent(org)}/property/${encodeURIComponent(property)}`;

/**
 * @param {{
 *   dataDir: string,
 *   safeStorage: { isEncryptionAvailable(): boolean, encryptString(text: string): Buffer, decryptString(buf: Buffer): string },
 *   fetch?: import("./blastcp-oauth.cjs").Fetch,
 *   openExternal?: (url: string) => void,
 *   login?: typeof signIn,
 *   swap?: typeof exchangeWeft,
 * }} options
 */
function createBlastcp({ dataDir, safeStorage, fetch: fetchImpl = globalThis.fetch, openExternal = () => {}, login = signIn, swap = exchangeWeft }) {
  const tokenFile = path.join(dataDir, TOKEN_FILE);
  const linksFile = path.join(dataDir, LINKS_FILE);
  const autoFile = path.join(dataDir, AUTO_FILE);
  let rpcId = 0;
  // BlastCP's page for confirming that your Weft account is your existing BlastCP account, until it's done.
  /** @type {string | null} */
  let linkUrl = null;

  function saved() {
    const data = readTokenRecord(tokenFile, safeStorage);
    return data ? { token: data.token, expiresAt: data.expiresAt ?? null, viaWeft: data.clientId === WEFT_CLIENT } : null;
  }

  const autoOff = () => {
    try {
      return JSON.parse(fs.readFileSync(autoFile, "utf8")).off === true;
    } catch {
      return false;
    }
  };
  function setAutoOff(off) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(autoFile, JSON.stringify({ off }));
  }

  /** @returns {Record<string, { org: string, property: string, name: string }>} */
  function links() {
    try {
      return JSON.parse(fs.readFileSync(linksFile, "utf8"));
    } catch {
      return {};
    }
  }

  function writeLinks(next) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(linksFile, JSON.stringify(next, null, 2));
  }

  // One MCP tools/call. Returns the tool's text; a tool error, a refused token or a JSON-RPC error throws.
  async function tool(name, args = {}, auth = saved()?.token) {
    if (!auth) throw new BlastcpError(401, "Connect BlastCP first.");
    const res = await fetchImpl(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
    });
    if (res.status === 401) throw new BlastcpError(401, "BlastCP's sign-in ran out. Connect again.");
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new BlastcpError(res.status, data.error?.message ?? `BlastCP answered ${res.status}.`);
    return textOf(data.result);
  }

  async function whoami(auth) {
    const me = JSON.parse(await tool("whoami", {}, auth));
    return { email: me.email ?? "you" };
  }

  // A linked folder's newest posts. "No posts yet" comes back as text, not JSON.
  async function posts(link) {
    const text = await tool("list_posts", { org_slug: link.org, property_slug: link.property, limit: POSTS });
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      return [];
    }
    return Array.isArray(data?.posts) ? data.posts.map(postOf) : [];
  }

  return {
    // Whether you're connected and as whom, and each folder's property with its posts. A folder whose
    // property can't be read keeps its link with an error, so you can still unlink it.
    /** @returns {Promise<import("../lib/blastcp-view").BlastcpStatus>} */
    async status(folders) {
      const session = fs.existsSync(tokenFile) ? saved() : null;
      let user = null;
      let error = null;
      if (session) {
        try {
          user = await whoami(session.token);
        } catch (err) {
          error = err.message;
        }
      }
      const all = links();
      const rows = await Promise.all(
        folders.map(async (folder) => {
          const link = all[folder] ?? null;
          const row = { folder, link: link && { ...link, url: propertyUrl(link.org, link.property) }, posts: null, error: null };
          if (!link || !user) return row;
          try {
            row.posts = await posts(link);
          } catch (err) {
            row.error = err.message;
          }
          return row;
        }),
      );
      return {
        signedIn: Boolean(session),
        user,
        expiresAt: session?.expiresAt ?? null,
        error,
        folders: rows,
        viaWeft: Boolean(session?.viaWeft),
        linkUrl: session && !error ? null : linkUrl,
      };
    },

    // Runs the browser sign-in and keeps the token. Only one at a time: a second Connect waits on the first.
    connect: (() => {
      /** @type {Promise<{ email: string }> | null} */
      let running = null;
      /** @returns {Promise<{ email: string }>} */
      return () => {
        running ??= (async () => {
          requireKeychain(safeStorage, "BlastCP sign-in");
          const { token, expiresAt, clientId } = await login({ fetch: fetchImpl, openExternal });
          const me = await whoami(token);
          writeToken(tokenFile, safeStorage, token, { expiresAt, clientId });
          return me;
        })().finally(() => (running = null));
        return running;
      };
    })(),

    // Connects with your Weft account's access token (lib/blastcp-auto.ts sends it: on Weft sign-in, twice a
    // day, and from the drawer's button, which passes force). A sign-in you made with Connect stays yours; one
    // made this way is renewed in its last week. After Disconnect only force connects again.
    async connectWeft(subjectToken, { force = false } = {}) {
      if (!subjectToken) throw new Error("Sign in to your Weft account first.");
      if (force) setAutoOff(false);
      else if (autoOff()) return { state: "off" };
      const session = fs.existsSync(tokenFile) ? saved() : null;
      const renew = session?.viaWeft && session.expiresAt !== null && Number(session.expiresAt) - Date.now() < RENEW_MS;
      if (session && !force && !renew) return { state: "connected" };
      requireKeychain(safeStorage, "BlastCP sign-in");
      const got = await swap({ fetch: fetchImpl, subjectToken });
      if (!got) return { state: "unavailable" };
      if ("linkUrl" in got) {
        linkUrl = got.linkUrl;
        return { state: "link", linkUrl };
      }
      const me = await whoami(got.token);
      writeToken(tokenFile, safeStorage, got.token, { expiresAt: got.expiresAt, clientId: got.clientId });
      linkUrl = null;
      return { state: "connected", email: me.email, created: got.created };
    },

    forget() {
      fs.rmSync(tokenFile, { force: true });
      setAutoOff(true);
      return { signedIn: false };
    },

    // Your workspaces and the properties in each, to link a folder to.
    async workspaces() {
      return parseWorkspaces(await tool("get_started"));
    },

    link(folder, org, property, name) {
      if (!path.isAbsolute(folder)) throw new Error("Pick a project folder first.");
      writeLinks({ ...links(), [folder]: { org, property, name: name || property } });
      return { linked: true, name: name || property };
    },

    // Makes a property in a workspace (BlastCP seeds its voice and playbooks) and links the folder to it.
    async createProperty(folder, org, name) {
      if (!path.isAbsolute(folder)) throw new Error("Pick a project folder first.");
      if (!name.trim()) throw new Error("Name the property first.");
      const made = JSON.parse(await tool("create_property", { org_slug: org, name: name.trim() }));
      return this.link(folder, made.org ?? org, made.property.slug, made.property.name);
    },

    unlink(folder) {
      const { [folder]: _gone, ...rest } = links();
      writeLinks(rest);
      return { linked: false };
    },
  };
}

// The IPC handlers. isBoard(sender) says whether a message came from the board window.
function registerBlastcp(ipcMain, { blastcp, isBoard }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("BlastCP only answers the board window.");
      return fn(...args);
    });
  handle("blastcp:status", (folders) => blastcp.status(Array.isArray(folders) ? folders.filter((f) => typeof f === "string") : []));
  handle("blastcp:connect", () => blastcp.connect());
  handle("blastcp:forget", () => blastcp.forget());
  handle("blastcp:workspaces", () => blastcp.workspaces());
  handle("blastcp:link", (folder, org, property, name) => blastcp.link(String(folder), String(org), String(property), String(name ?? "")));
  handle("blastcp:create-property", (folder, org, name) => blastcp.createProperty(String(folder), String(org), String(name ?? "")));
  handle("blastcp:unlink", (folder) => blastcp.unlink(String(folder)));
}

// Wires BlastCP into Electron main for the board window (board() is its webContents).
function setupBlastcp({ ipcMain, dataDir, board }) {
  const { shell } = require("electron");
  const safeStorage = require("./keychain-audit.cjs").keychainFor("BlastCP sign-in");
  const blastcp = createBlastcp({ dataDir, safeStorage, openExternal: (url) => shell.openExternal(url) });
  registerBlastcp(ipcMain, { blastcp, isBoard: (sender) => Boolean(sender) && sender === board() });
  return blastcp;
}

module.exports = { setupBlastcp, createBlastcp, registerBlastcp, parseWorkspaces, postOf, BlastcpError, TOKEN_FILE, LINKS_FILE, AUTO_FILE };
