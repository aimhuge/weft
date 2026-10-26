// Cloudflare's side of Electron main (docs/architecture/cloudflare.md): your Cloudflare API token, sealed by
// safeStorage (the Keychain) so threads never see it, the Workers and Pages projects it can reach, and which one
// each folder is linked to. Cloudflare has no link file of its own, so links live in Weft's data folder; a
// folder's wrangler config only suggests one. Like the vault, it answers the board only.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CloudflareError, failureOf, narrowToken, pagesGit, pagesDeploy, pagesRow, pagesUrl, request, workerDeploy, workerRow, workerUrl, wranglerOf } = require("./cloudflare-api.cjs");
const { gitRemote, mustBeFolder, repoOf } = require("./vercel-project.cjs");
const { readToken, requireKeychain, writeToken } = require("./provider-token.cjs");

const TOKEN_FILE = "cloudflare-token.json";
const LINKS_FILE = "cloudflare-links.json";
const KINDS = ["worker", "pages"];
// Pages lists its projects a page at a time; this many pages is plenty to pick from.
const MAX_PAGES = 10;
// A token Weft just made can take a moment to work everywhere: this many tries, a second apart.
const NEW_TOKEN_TRIES = 3;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createCloudflare({
  dataDir,
  safeStorage,
  fetch: fetchImpl = globalThis.fetch,
  remote = gitRemote,
  host = os.hostname().replace(/\.local$/, ""),
  sleep = pause,
}) {
  const tokenFile = path.join(dataDir, TOKEN_FILE);
  const linksFile = path.join(dataDir, LINKS_FILE);

  function token() {
    return readToken(tokenFile, safeStorage);
  }

  /** @returns {Record<string, { kind: "worker" | "pages", accountId: string, name: string }>} */
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

  // Cloudflare's whole answer: { success, errors, result, result_info }.
  async function answer(pathname, { auth = token(), query, method, body } = {}) {
    if (!auth) throw new CloudflareError(401, "Add a Cloudflare token first.");
    const { url, init } = request(pathname, { auth, query, method, body });
    const res = await fetchImpl(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) throw failureOf(res.status, data);
    return data;
  }

  const call = async (pathname, options) => (await answer(pathname, options)).result;

  // The accounts the token reaches. An account-owned token sees just its own.
  async function accounts(auth) {
    const list = (await call("/accounts", { auth, query: { per_page: 50 } })) ?? [];
    if (!list.length) throw new CloudflareError(403, "This token reaches no Cloudflare account. Give it Account access.");
    return list.map((a) => ({ id: a.id, name: a.name ?? a.id }));
  }

  // A just-made token's accounts, tried a few times while Cloudflare catches up.
  async function newTokenAccounts(auth) {
    for (let tryNo = 1; ; tryNo++) {
      try {
        return await accounts(auth);
      } catch (err) {
        if (tryNo >= NEW_TOKEN_TRIES) throw err;
        await sleep(1000);
      }
    }
  }

  // A setup token (Cloudflare's "Create additional tokens" template) can list the permission groups a
  // token may get; any other token can't, and this returns null for it. With one, Weft makes its own
  // narrower token ("Weft on <this Mac>", NARROW in electron/cloudflare-api.cjs) and returns it with the
  // setup token's id, so the setup token can be deleted once the new one is kept. A new token that doesn't
  // work is deleted again.
  async function fromSetupToken(setup) {
    const groups = await call("/user/tokens/permission_groups", { auth: setup }).catch(() => null);
    if (!groups) return null;
    const { id: setupId } = await call("/user/tokens/verify", { auth: setup });
    const made = await call("/user/tokens", { auth: setup, method: "POST", body: narrowToken(`Weft on ${host}`, groups) });
    try {
      return { value: made.value, setupId, list: await newTokenAccounts(made.value) };
    } catch (err) {
      await call(`/user/tokens/${made.id}`, { auth: setup, method: "DELETE" }).catch(() => {});
      throw err;
    }
  }

  // How the drawer names who you are: the account, or the first one and how many more.
  const accountLabel = (list) => (list.length > 1 ? `${list[0].name} +${list.length - 1}` : list[0].name);

  const base = (accountId) => `/accounts/${encodeURIComponent(accountId)}`;

  async function pagesProjects(account) {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { result = [], result_info: info } = await answer(`${base(account.id)}/pages/projects`, { query: { page } });
      all.push(...result.map((p) => pagesRow(p, account)));
      if (page >= (info?.total_pages ?? 1)) break;
    }
    return all;
  }

  async function workers(account) {
    const scripts = (await call(`${base(account.id)}/workers/scripts`)) ?? [];
    return scripts.map((s) => workerRow(s, account));
  }

  async function linkedStatus(link, list) {
    const account = list.find((a) => a.id === link.accountId)?.name ?? null;
    const dash = `https://dash.cloudflare.com/${link.accountId}`;
    const name = encodeURIComponent(link.name);
    if (link.kind === "pages") {
      const p = await call(`${base(link.accountId)}/pages/projects/${name}`);
      return { ...link, account, git: pagesGit(p), url: pagesUrl(p), dashboard: `${dash}/pages/view/${link.name}`, latest: pagesDeploy(p.latest_deployment) };
    }
    const script = `${base(link.accountId)}/workers/scripts/${name}`;
    // Only the deployments must answer: they say the Worker is there. The address is a best effort.
    const [deployed, subdomain, domains, workersDev] = await Promise.all([
      call(`${script}/deployments`),
      call(`${base(link.accountId)}/workers/subdomain`).then((r) => r?.subdomain ?? null, () => null),
      call(`${base(link.accountId)}/workers/domains`, { query: { service: link.name } }).catch(() => null),
      call(`${script}/subdomain`).then((r) => r?.enabled, () => undefined),
    ]);
    return {
      ...link,
      account,
      git: null,
      url: workerUrl(link.name, { domains, subdomain, workersDev }),
      dashboard: `${dash}/workers/services/view/${link.name}/production`,
      latest: workerDeploy(deployed?.deployments),
    };
  }

  return {
    // Whether a token is saved and which account it reaches, and each folder's GitHub repo, wrangler config and
    // link. A folder whose project can't be read keeps its link with an error, so you can still unlink it.
    /** @returns {Promise<import("../lib/cloudflare-view").CloudflareStatus>} */
    async status(folders) {
      const signedIn = fs.existsSync(tokenFile);
      let list = null;
      let error = null;
      if (signedIn) {
        try {
          list = await accounts();
        } catch (err) {
          error = err.message;
        }
      }
      const saved = links();
      const rows = await Promise.all(
        folders.map(async (folder) => {
          const link = saved[folder] ?? null;
          const row = { folder, repo: await repoOf(folder, remote), wrangler: wranglerOf(folder), link, error: null };
          if (!link || !list) return row;
          try {
            row.link = await linkedStatus(link, list);
          } catch (err) {
            row.error = err.message;
          }
          return row;
        }),
      );
      return { signedIn, user: list ? { name: accountLabel(list) } : null, error, folders: rows };
    },

    // Checks the token with Cloudflare before keeping it. A setup token isn't kept: Weft makes its own
    // narrower token with it, keeps that, then deletes the setup token (setupDeleted says whether it could).
    async setToken(value) {
      const given = String(value ?? "").trim();
      if (!given) throw new Error("Paste a token from dash.cloudflare.com/profile/api-tokens.");
      requireKeychain(safeStorage);
      const made = await fromSetupToken(given);
      const auth = made?.value ?? given;
      const list = made?.list ?? (await accounts(auth));
      writeToken(tokenFile, safeStorage, auth);
      if (!made) return { name: accountLabel(list) };
      const setupDeleted = await call(`/user/tokens/${made.setupId}`, { auth: given, method: "DELETE" }).then(
        () => true,
        () => false,
      );
      return { name: accountLabel(list), made: true, setupDeleted };
    },

    forgetToken() {
      fs.rmSync(tokenFile, { force: true });
      return { signedIn: false };
    },

    // Every Worker and Pages project the token reaches, newest first. A list that fails (the token has no
    // Pages permission, say) is left out, unless they all fail.
    /** @returns {Promise<import("../lib/cloudflare-view").CloudflareProject[]>} */
    async projects() {
      const list = await accounts();
      const lists = await Promise.allSettled(list.flatMap((a) => [workers(a), pagesProjects(a)]));
      const failed = lists.find((l) => l.status === "rejected");
      if (failed && lists.every((l) => l.status === "rejected")) throw failed.reason;
      return lists.flatMap((l) => (l.status === "fulfilled" ? l.value : [])).sort((a, b) => b.updatedAt - a.updatedAt);
    },

    // Links the folder, after checking the Worker or Pages project is really there.
    async link(folder, kind, accountId, name) {
      mustBeFolder(folder);
      if (!KINDS.includes(kind)) throw new Error("Link a Worker or a Pages project.");
      const at = `${base(accountId)}/${kind === "pages" ? "pages/projects" : "workers/scripts"}/${encodeURIComponent(name)}`;
      await call(kind === "pages" ? at : `${at}/deployments`);
      writeLinks({ ...links(), [folder]: { kind, accountId, name } });
      return { linked: true, name };
    },

    unlink(folder) {
      const { [folder]: _gone, ...rest } = links();
      writeLinks(rest);
      return { linked: false };
    },
  };
}

// The IPC handlers. isBoard(sender) says whether a message came from the board window.
function registerCloudflare(ipcMain, { cloudflare, isBoard }) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isBoard(event.sender)) throw new Error("Cloudflare only answers the board window.");
      return fn(...args);
    });
  handle("cloudflare:status", (folders) => cloudflare.status(Array.isArray(folders) ? folders.filter((f) => typeof f === "string") : []));
  handle("cloudflare:set-token", (value) => cloudflare.setToken(String(value ?? "")));
  handle("cloudflare:forget-token", () => cloudflare.forgetToken());
  handle("cloudflare:projects", () => cloudflare.projects());
  handle("cloudflare:link", (folder, kind, accountId, name) => cloudflare.link(String(folder), String(kind), String(accountId), String(name)));
  handle("cloudflare:unlink", (folder) => cloudflare.unlink(String(folder)));
}

// Wires Cloudflare into Electron main for the board window (board() is its webContents).
function setupCloudflare({ ipcMain, dataDir, board }) {
  const safeStorage = require("./keychain-audit.cjs").keychainFor("Cloudflare token");
  const cloudflare = createCloudflare({ dataDir, safeStorage });
  registerCloudflare(ipcMain, { cloudflare, isBoard: (sender) => Boolean(sender) && sender === board() });
  return cloudflare;
}

module.exports = { setupCloudflare, createCloudflare, registerCloudflare, TOKEN_FILE, LINKS_FILE };
