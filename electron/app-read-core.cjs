// The two read kinds a data mini app may declare in its weft-app.json (docs/architecture/mini-apps.md),
// written once for both places that run them: Electron main for a local app (electron/app-data-reads.cjs)
// and the hosted route for a weft.zip app (app/api/a/[id]/read/route.ts through lib/app-read.ts). Two
// copies used to drift: dde1126 gated the Supabase host in the route only, and the local read stayed open.
// A read is a pure function of (values, body, fetch): the caller hands in the secret values, the manifest's
// entry and its fetch. Every refusal throws an Error tagged with err.kind (and err.status for an upstream
// answer); main hands the kind to the page, the route maps it to an HTTP status. The row cap (5,000), the
// 2 MB cap and the 15 s timeout live here. It is CommonJS in electron/ because main can't import .ts and
// only electron/** ships in the packaged app; the route imports it the way the fetch route imports
// app-fetch-run.cjs.

const { createSign } = require("node:crypto");

// Hard caps, every read enforces them. Results are returned to the page as JSON, so the cap protects
// the renderer from a giant payload as much as it does main's memory.
const ROW_LIMIT = 5_000;
const BYTE_LIMIT = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

// PostgREST's function name: a Postgres identifier (lowercase, digits, underscore; underscore allowed
// to lead, so fns like `_helper` work too). Capped at 63 to mirror Postgres' NAMEDATALEN-1.
const RPC_FN = /^[a-z_][a-z0-9_]{0,62}$/;
// The only host a Supabase read may send the author's secret to: an https Supabase project URL.
// The rule and its reasoning live in lib/app-folder.ts (safeSupabaseUrl); this is its CJS twin, because
// main can't import a .ts module. KEEP IN STEP with that one — the two must always agree, and
// electron/app-data-reads.test.ts asserts the same cases lib/app-folder.test.ts does.
const SUPABASE_HOST_RE = /^[a-z0-9][a-z0-9-]*\.supabase\.(co|in)$/i;

// Whether a manifest's supabaseUrl is safe to send the author's secret to: the normalised origin, or
// null. A weft-app.json is untrusted input (anyone can save an app), so this is checked at manifest
// load (app-data-frame.cjs locally, lib/app-folder.ts for a hosted row) AND again in runSupabase, before
// the secret is read, so a row or a manifest written before the rule still can't leak.
function safeSupabaseUrl(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // No credentials in the URL, and no port: the host must be the bare project host.
  if (url.username || url.password || url.port) return null;
  if (!SUPABASE_HOST_RE.test(url.hostname)) return null;
  return url.origin;
}
// Manifest read names (weft-app.json's reads map keys).
const READ_NAME = /^[a-z][a-z0-9_-]{0,39}$/;
// A primitive arg the page may pass: string, number or boolean. Nothing else reaches the network.
function isPrimitive(v) {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

// Throws a plain-English error tagged with its kind; status is the upstream's HTTP status when it answered.
function reject(kind, message, status) {
  const err = new Error(message);
  err.kind = kind;
  if (status !== undefined) err.status = status;
  throw err;
}

// The message for a fetch that threw: the 15 s abort, or the network's own reason.
function rejectFetchError(err, what) {
  if (err.name === "AbortError") reject("timeout", `${what} didn't answer in ${TIMEOUT_MS / 1000} s.`);
  if (err.kind) throw err;
  reject("network", `Couldn't reach ${what}: ${err.message || "no answer"}.`);
}

const TOO_LARGE = `The read returned more than ${BYTE_LIMIT / 1024 / 1024} MB. Narrow the args or shorten the date range.`;

// The readable part of an error body: Supabase's { message, hint }, Google's { error: { message } } or
// { error_description }, else the text itself (cut short), else the fallback.
function upstreamMessage(text, fallback) {
  try {
    const body = JSON.parse(text);
    const msg = body?.message ?? body?.error?.message ?? body?.error_description;
    if (typeof msg === "string" && msg) return body.hint ? `${msg} (${body.hint})` : msg;
  } catch {}
  return text ? text.slice(0, 300) : fallback;
}

// A typed timeout: AbortController so fetch breaks on the 15 s cap regardless of platform.
function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

// Caps the JSON-serialised result at 5,000 rows or 2 MB; throws past the cap so a too-large reply
// never reaches the page.
function trimToCaps(value) {
  // value is whatever the read returned: an object, a list of rows, etc.
  const serialised = JSON.stringify(value);
  if (serialised.length > BYTE_LIMIT) reject("too-large", TOO_LARGE);
  if (Array.isArray(value)) {
    if (value.length > ROW_LIMIT) return value.slice(0, ROW_LIMIT);
  } else if (value && typeof value === "object") {
    // The PostgREST table RPC case is the array path; a scalar return passes through here as-is.
  }
  return value;
}

// A plain object as-is; anything else (an array, null, a primitive) as an empty one.
function plainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

// The manifest's args are the defaults; the page may override only keys the manifest declared, with the same
// primitive type. A page that changes a type is refused before any network call; an undeclared key is dropped.
// defaults: false sends only what the page passed. Both the Mac and the hosted route send defaults, as
// docs/architecture/mini-apps.md promises.
function cleanArgs(declaredArgs, pageArgs, { defaults = true } = {}) {
  const cleaned = {};
  const declared = plainObject(declaredArgs);
  const given = plainObject(pageArgs);
  for (const [key, want] of Object.entries(declared)) {
    if (defaults && isPrimitive(want)) cleaned[key] = want;
    if (!(key in given)) continue;
    // Without defaults a non-primitive declaration declares nothing (the route's rule); with them it still
    // refuses whatever the page sends for it, since no primitive matches an object's type.
    if (!defaults && !isPrimitive(want)) continue;
    const got = given[key];
    if (!isPrimitive(got)) reject("bad-args", `Arg ${key} must be a string, number or boolean.`);
    if (typeof want !== typeof got) reject("bad-args", `Arg ${key} is a ${typeof want} in the manifest, not a ${typeof got}.`);
    cleaned[key] = got;
  }
  return cleaned;
}

// A supabase read: GET {supabaseUrl}/rest/v1/rpc/{fn}?args with the env's SUPABASE_SECRET_KEY. GET, not POST, so
// the database itself keeps it a read: PostgREST runs a GET in a read-only transaction and only calls a stable or
// immutable function that way, so a manifest naming a function that writes gets an error, not a write.
async function runSupabase({ supabaseUrl, fn, declaredArgs, pageArgs, values, fetch: fetchImpl, defaults = true }) {
  if (!RPC_FN.test(String(fn ?? ""))) reject("bad-request", `Function name ${JSON.stringify(fn)} isn't a Postgres identifier.`);
  // The manifest's supabaseUrl decides where the author's SUPABASE_SECRET_KEY is sent, so it is checked
  // here as well as when the manifest was reduced (app-data-frame.cjs): a weft-app.json written before
  // that rule, or edited since, must not be able to point the key at a host of its choosing.
  // safeSupabaseUrl returns the normalised origin or null; null refuses before the secret is read.
  const origin = safeSupabaseUrl(supabaseUrl);
  if (!origin) reject("manifest", "This app's supabaseUrl isn't a Supabase project URL.");
  const secret = values.SUPABASE_SECRET_KEY;
  if (!secret) reject("missing", `SUPABASE_SECRET_KEY has no value yet.`);
  const cleaned = cleanArgs(declaredArgs, pageArgs, { defaults });
  // Built on the validated origin, not the raw manifest string: a URL like
  // https://abc.supabase.co@attacker.example/ would pass a naive suffix check but must never be reachable.
  const target = new URL(`/rest/v1/rpc/${fn}`, origin);
  for (const [key, value] of Object.entries(cleaned)) target.searchParams.set(key, String(value));
  const url = target.toString();
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { apikey: secret, authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: t.signal,
    });
    const text = await res.text();
    if (!res.ok) reject("upstream", upstreamMessage(text, `Supabase answered ${res.status}.`), res.status);
    if (text.length > BYTE_LIMIT) reject("too-large", TOO_LARGE);
    const json = text ? JSON.parse(text) : null;
    return trimToCaps(json);
  } catch (err) {
    rejectFetchError(err, "Supabase");
  } finally {
    t.cancel();
  }
}

// Flattens a GA4 runReport response to [{ dimension: value, metric: number, ... }]. The dimension
// and metric header names are the keys; metric values become numbers (GA4 sends them as strings).
function flattenGa4(report) {
  const dims = report?.dimensionHeaders ?? [];
  const metrics = report?.metricHeaders ?? [];
  const rows = report?.rows ?? [];
  return rows.slice(0, ROW_LIMIT).map((row) => {
    const out = {};
    for (let i = 0; i < dims.length; i++) out[dims[i].name] = row.dimensionValues?.[i]?.value ?? "";
    for (let i = 0; i < metrics.length; i++) {
      const raw = row.metricValues?.[i]?.value;
      const n = Number(raw);
      out[metrics[i].name] = Number.isFinite(n) ? n : raw;
    }
    return out;
  });
}

// RS256 signs the JWT for the Google service account, with PEM and the JWT-spec base64url encoding.
function signServiceAccountJwt({ clientEmail, privateKey, tokenUri = "https://oauth2.googleapis.com/token", now = () => Math.floor(Date.now() / 1000) }) {
  const iat = now();
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: tokenUri,
    iat,
    exp: iat + 3600,
  };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

// Trades a signed JWT for an access token. Returns { accessToken, expiresAt } so the caller can cache
// it. tokenUri is the service account's, or the default when missing.
async function exchangeToken({ clientEmail, privateKey, tokenUri = "https://oauth2.googleapis.com/token", fetch: fetchImpl, now = Date.now }) {
  const assertion = signServiceAccountJwt({ clientEmail, privateKey, tokenUri });
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetchImpl(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      signal: t.signal,
    });
    const text = await res.text();
    if (!res.ok) reject("upstream", upstreamMessage(text, `Google's token endpoint answered ${res.status}.`), res.status);
    const json = JSON.parse(text);
    if (typeof json?.access_token !== "string") reject("upstream", "Google's token endpoint didn't return an access token.");
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
    // 60 s before expiry so a slow request doesn't ship an expired token.
    return { accessToken: json.access_token, expiresAt: now() + (expiresIn * 1000) - 60_000 };
  } catch (err) {
    rejectFetchError(err, "Google's token endpoint");
  } finally {
    t.cancel();
  }
}

// The service-account JSON's two fields the JWT needs; anything else is refused before signing.
function parseServiceAccount(saJson) {
  let sa;
  try {
    sa = JSON.parse(saJson);
  } catch {
    reject("missing", `GA4_SERVICE_ACCOUNT_JSON isn't valid JSON.`);
  }
  if (typeof sa?.client_email !== "string" || typeof sa?.private_key !== "string") {
    reject("missing", "GA4_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  }
  return sa;
}

// A GA4 read: mints a token from the service-account JSON, calls runReport, flattens. The token cache
// lives in main (caller hands in a Map) so one pane page doesn't mint a token every click.
async function runGa4({ body, values, fetch: fetchImpl, now = Date.now, tokens }) {
  const propertyId = values.GA4_PROPERTY_ID;
  const saJson = values.GA4_SERVICE_ACCOUNT_JSON;
  if (!propertyId) reject("missing", `GA4_PROPERTY_ID has no value yet.`);
  if (!saJson) reject("missing", `GA4_SERVICE_ACCOUNT_JSON has no value yet.`);
  const sa = parseServiceAccount(saJson);
  const cacheKey = sa.client_email;
  let cached = tokens.get(cacheKey);
  if (!cached || cached.expiresAt < now()) {
    cached = await exchangeToken({ clientEmail: sa.client_email, privateKey: sa.private_key, fetch: fetchImpl, now });
    tokens.set(cacheKey, cached);
  }
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${cached.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: t.signal,
    });
    const text = await res.text();
    if (!res.ok) reject("upstream", upstreamMessage(text, `GA4 answered ${res.status}.`), res.status);
    if (text.length > BYTE_LIMIT) reject("too-large", TOO_LARGE);
    const report = JSON.parse(text);
    return trimToCaps(flattenGa4(report));
  } catch (err) {
    rejectFetchError(err, "GA4");
  } finally {
    t.cancel();
  }
}

module.exports = { upstreamMessage, cleanArgs, runSupabase, runGa4, flattenGa4, signServiceAccountJwt, exchangeToken, isPrimitive, safeSupabaseUrl, RPC_FN, READ_NAME, ROW_LIMIT, BYTE_LIMIT, TIMEOUT_MS };
