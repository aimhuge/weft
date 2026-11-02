// Short-lived tokens from this Mac's own connector sign-ins, for a Weft Worker that was given one in Settings → Devices
// (electron/worker-connectors.cjs, docs/architecture/project-hosts.md#the-vault-and-connectors-on-a-worker-t2-as-built).
// Google: gog keeps a refresh token in the Keychain; main exports it once into a private temp folder (removed at once),
// keeps it in memory only, and trades it at Google for an hour-long access token each time. The refresh token never
// leaves this Mac. GitHub: gh's own token for the account, which GitHub doesn't expire, so the worker forgets it after
// GH_TTL_MS and this Mac sends it again while the connector stays on.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const GH_TTL_MS = 8 * 60 * 60_000;
const GITHUB_TOKEN = /^(github_pat_|gh[opsu]_)\w{20,}$/;
const GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** @param {string} bin @param {string[]} args @returns {Promise<string>} */
const run = (bin, args) =>
  new Promise((resolve, reject) => execFile(bin, args, { timeout: 30_000, maxBuffer: 1 << 20 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))));

// The first `name` on PATH or in the usual places a packaged app's PATH leaves out, then Weft's own toolchain.
/** @param {string} name @param {{ env?: Record<string, string | undefined>, extra?: string[] }} [opts] @returns {string | null} */
function findBin(name, { env = process.env, extra = ["/opt/homebrew/bin", "/usr/local/bin", path.join(__dirname, "..", "toolchain", "bin")] } = {}) {
  for (const dir of [...String(env.PATH ?? "").split(path.delimiter), ...extra]) {
    if (!dir) continue;
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      // Not here.
    }
  }
  return null;
}

// A Google OAuth client file as gog stores it, or as the console downloads it.
function clientOf(json) {
  const c = json?.installed ?? json?.web ?? json ?? {};
  if (typeof c.client_id !== "string" || typeof c.client_secret !== "string") throw new Error("gog's OAuth client on this Mac has no id and secret.");
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

/**
 * @param {{ exec?: typeof run, fetchImpl?: typeof fetch, which?: (name: string) => string | null, tmp?: () => string, now?: () => number }} [deps]
 */
function createMint({ exec = run, fetchImpl = fetch, which = (name) => findBin(name), tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-gog-")), now = Date.now } = {}) {
  /** @type {Map<string, { refreshToken: string, clientId: string, clientSecret: string }>} */
  const secrets = new Map();
  const bin = (name) => {
    const found = which(name);
    if (!found) throw new Error(`${name} isn't installed on this Mac.`);
    return found;
  };

  async function gogSecrets(account) {
    const kept = secrets.get(account);
    if (kept) return kept;
    const gog = bin("gog");
    const keys = JSON.parse(await exec(gog, ["auth", "tokens", "list", "--json"])).keys ?? [];
    const client = keys.map((k) => /^token:([^:]+):(.+)$/.exec(String(k))).find((m) => m?.[2] === account)?.[1];
    if (!client) throw new Error(`${account} isn't signed in to gog on this Mac. Sign it in at Settings → Connectors first.`);
    const dir = tmp();
    let exported;
    try {
      const file = path.join(dir, "token.json");
      await exec(gog, ["auth", "tokens", "export", account, "--client", client, "--out", file, "--overwrite"]);
      exported = JSON.parse(fs.readFileSync(file, "utf8"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const refreshToken = exported?.refresh_token ?? exported?.token?.refresh_token;
    if (typeof refreshToken !== "string" || !refreshToken) throw new Error(`gog on this Mac has no refresh token for ${account}.`);
    const clients = JSON.parse(await exec(gog, ["auth", "credentials", "list", "--json"])).clients ?? [];
    const where = clients.find((c) => c?.client === client)?.path;
    if (typeof where !== "string") throw new Error(`gog's OAuth client "${client}" isn't on this Mac.`);
    const found = { refreshToken, ...clientOf(JSON.parse(fs.readFileSync(where, "utf8"))) };
    secrets.set(account, found);
    return found;
  }

  return {
    /** An hour-long Google access token for the account, from its refresh token. */
    async gog(account) {
      const s = await gogSecrets(account);
      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refreshToken, client_id: s.clientId, client_secret: s.clientSecret });
      const res = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || typeof json.access_token !== "string") {
        secrets.delete(account);
        throw new Error(`Google refused to refresh ${account}: ${json.error_description ?? json.error ?? res.status}. Sign it in again at Settings → Connectors.`);
      }
      return { token: json.access_token, account, expiresAt: now() + (Number(json.expires_in) || 3600) * 1000 };
    },
    /** gh's token for the account (its active one when none is named). */
    async gh(account) {
      const token = (await exec(bin("gh"), ["auth", "token", "--hostname", "github.com", ...(account ? ["--user", account] : [])])).trim();
      if (!GITHUB_TOKEN.test(token)) throw new Error("gh on this Mac isn't signed in to GitHub.");
      return { token, account, expiresAt: now() + GH_TTL_MS };
    },
    /** The GitHub login gh is signed in as here, to name in the approval. */
    async ghAccount() {
      const login = (await exec(bin("gh"), ["api", "user", "--jq", ".login"])).trim();
      if (!GH_LOGIN.test(login)) throw new Error("gh on this Mac isn't signed in to GitHub.");
      return login;
    },
    /** Drops a Google account's refresh token from memory. */
    forget: (account) => void secrets.delete(account),
  };
}

module.exports = { createMint, findBin, clientOf, GH_TTL_MS, GH_LOGIN };
