// BlastCP's sign-in (docs/architecture/blastcp.md): OAuth 2.1 with PKCE against blastcp.com, the way an
// MCP client connects. Weft registers itself as a public client for one loopback redirect, opens the
// consent page in your browser, and catches the code on a one-shot server on 127.0.0.1.
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ORIGIN = "https://blastcp.com";
const SCOPE = "blastcp:all";
// How long Connect waits for you to finish in the browser.
const WAIT_MS = 5 * 60_000;

// fetch as BlastCP's side uses it; tests pass a fake.
/** @typedef {(url: string, init: { method: string, headers: Record<string, string>, body: string }) => Promise<{ ok: boolean, status: number, json: () => Promise<any> }>} Fetch */

/** @param {Buffer} buf */
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** @returns {{ verifier: string, challenge: string, state: string }} */
function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), state: b64url(crypto.randomBytes(16)) };
}

// BlastCP's rocket (public/brand/blastcp-rocket.png) inline, or 🚀 if the file isn't there.
const ROCKET = (() => {
  try {
    return `<img src="data:image/png;base64,${fs.readFileSync(path.join(__dirname, "..", "public", "brand", "blastcp-rocket.png")).toString("base64")}" width="48" height="48" alt="">`;
  } catch {
    return "🚀";
  }
})();

const PAGE = (title, text) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0f1115;color:#e6e6e6"><div style="text-align:center"><div style="font-size:40px">${ROCKET}</div><h1 style="font-size:18px">${title}</h1><p style="color:#9aa0aa">${text}</p></div>`;

// Listens on 127.0.0.1 at a free port for BlastCP's redirect. result settles with { code, state } or
// an error (you said no, or the wait ran out); close() stops it either way.
/** @typedef {{ redirectUri: string, result: Promise<{ code: string, state: string | null }>, close: () => void }} Loopback */
/** @returns {Promise<Loopback>} */
function startLoopback({ waitMs = WAIT_MS } = {}) {
  return new Promise((resolve, reject) => {
    /** @type {{ ok: (v: { code: string, state: string | null }) => void, fail: (e: Error) => void }} */
    let settle = { ok: () => {}, fail: () => {} };
    /** @type {Promise<{ code: string, state: string | null }>} */
    const result = new Promise((ok, fail) => (settle = { ok, fail }));
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (code) {
        res.end(PAGE("Connected to BlastCP", "You can close this tab and go back to Weft."));
        settle.ok({ code, state: url.searchParams.get("state") });
      } else {
        res.end(PAGE("BlastCP didn't connect", "Go back to Weft and try Connect again."));
        settle.fail(new Error(error === "access_denied" ? "You turned BlastCP down in the browser." : `BlastCP answered ${error ?? "with no code"}.`));
      }
    });
    const timer = setTimeout(() => settle.fail(new Error("BlastCP sign-in timed out. Try Connect again.")), waitMs);
    const close = () => {
      clearTimeout(timer);
      server.close();
    };
    result.catch(() => {});
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
      resolve({ redirectUri: `http://127.0.0.1:${port}/callback`, result, close });
    });
  });
}

// The authorize page's address for one sign-in.
function authorizeUrl({ clientId, redirectUri, challenge, state }) {
  const url = new URL("/api/oauth/authorize", ORIGIN);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: SCOPE,
    resource: `${ORIGIN}/api/mcp`,
  }).toString();
  return url.href;
}

// The whole sign-in: register, open the browser, wait, swap the code for a token. Returns
// { token, expiresAt, clientId }. fetch, openExternal and loopback are injected for tests.
/**
 * @param {{ fetch: Fetch, openExternal: (url: string) => void, loopback?: () => Promise<Loopback> }} options
 * @returns {Promise<{ token: string, expiresAt: number | null, clientId: string }>}
 */
async function signIn({ fetch, openExternal, loopback = startLoopback }) {
  const server = await loopback();
  try {
    const reg = await fetch(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Weft", redirect_uris: [server.redirectUri] }),
    });
    const client = await reg.json().catch(() => ({}));
    if (!reg.ok || !client.client_id) throw new Error(client.error_description ?? `BlastCP wouldn't register Weft (${reg.status}).`);
    const { verifier, challenge, state } = pkce();
    openExternal(authorizeUrl({ clientId: client.client_id, redirectUri: server.redirectUri, challenge, state }));
    const back = await server.result;
    if (back.state !== state) throw new Error("BlastCP's answer didn't match this sign-in. Try Connect again.");
    const res = await fetch(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: back.code, code_verifier: verifier, client_id: client.client_id, redirect_uri: server.redirectUri }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(data.error_description ?? `BlastCP wouldn't give Weft a token (${res.status}).`);
    const expiresAt = data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null;
    return { token: data.access_token, expiresAt, clientId: client.client_id };
  } finally {
    server.close();
  }
}

// Connecting with your Weft account (docs/architecture/blastcp.md): BlastCP trusts a signed-in Weft session
// (RFC 8693 token exchange against Weft's published signing keys), so Weft swaps its account's access token for
// a BlastCP one with no browser, and BlastCP makes the account the first time. Returns
// { token, expiresAt, clientId, created }; { linkUrl } when that email already has a BlastCP account, which
// confirms the link once on BlastCP; or null when this BlastCP can't swap (a server from before the grant).
const WEFT_CLIENT = "weft";

/** @param {{ fetch: Fetch, subjectToken: string }} options */
async function exchangeWeft({ fetch, subjectToken }) {
  const res = await fetch(`${ORIGIN}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: subjectToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      client_id: WEFT_CLIENT,
      scope: SCOPE,
      resource: `${ORIGIN}/api/mcp`,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.access_token) {
    const expiresAt = data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null;
    return { token: data.access_token, expiresAt, clientId: WEFT_CLIENT, created: data.created === true };
  }
  // The drawer opens this link, so only a BlastCP page: anything else would be a phishing hop.
  if (data.error === "link_required" && typeof data.link_url === "string" && data.link_url.startsWith(`${ORIGIN}/`)) return { linkUrl: data.link_url };
  if (data.error === "unsupported_grant_type" || data.error === "invalid_client") return null;
  throw new Error(data.error_description ?? `BlastCP wouldn't take your Weft sign-in (${res.status}).`);
}

module.exports = { ORIGIN, SCOPE, WEFT_CLIENT, authorizeUrl, exchangeWeft, pkce, signIn, startLoopback };
