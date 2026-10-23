// The messages between a hosted mini app and the page around it (docs/architecture/mini-app-hosting.md). On weft.zip an
// app runs in a sandboxed frame with an opaque origin: it has no cookies and holds no keys. A small script Weft adds to
// its HTML defines `window.weft`, whose calls post a BridgeRequest to the parent page (Weft's own /@user/apps/<slug> or
// /<org>/apps/<slug>), which holds the link's gate cookie, calls Weft's routes for the app and posts a BridgeResponse back.
// In Weft on the Mac the same `window.weft` comes from the pane's preload (electron/pane-preload.cjs) and Electron main
// answers it, so an app's code is the same in both places. Pure, so both sides import it.

export const BRIDGE_TAG = "weft-app-bridge/1";

// What `weft.fetch(url, init)` resolves to: never a Response (it can't cross the Mac's context bridge), always plain
// data. A text answer comes as utf8; anything else as base64. A secret the answer echoed is masked as ‹NAME›.
export interface AppFetchResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: "utf8" | "base64";
}

// `weft.fetch`'s request: placeholders like `{{secret:STRIPE_KEY}}` may sit in the URL, a header value or the body;
// Weft swaps the value in outside the browser, only where the app's policy allows that secret to go.
export interface AppFetchRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export type BridgeRequest =
  | ({ tag: typeof BRIDGE_TAG; id: number; op: "fetch" } & AppFetchRequest)
  // A named read from the manifest (a Supabase function, a GA4 report), as data apps call it on the Mac today.
  | { tag: typeof BRIDGE_TAG; id: number; op: "read"; name: string; args?: Record<string, unknown> }
  // Asks Weft (never the app) to collect this viewer's own value for a `from: "viewer"` secret; resolves to whether it's set.
  | { tag: typeof BRIDGE_TAG; id: number; op: "requestSecret"; name: string }
  // The app's public values (publishable keys) by name.
  | { tag: typeof BRIDGE_TAG; id: number; op: "env" }
  // What the app's reads run as and whether they can: the Mac's data-app access() shape, so a page written for the
  // Mac (Growth) gets past its first call on weft.zip. requestAccess() and revoke() send it too: on weft.zip the
  // author's uploaded values are the grant, and a viewer has nothing to grant or revoke.
  | { tag: typeof BRIDGE_TAG; id: number; op: "access" };

export type BridgeResponse =
  | { tag: typeof BRIDGE_TAG; id: number; ok: true; result: unknown }
  | { tag: typeof BRIDGE_TAG; id: number; ok: false; error: string };

const OPS = new Set(["fetch", "read", "requestSecret", "env", "access"]);

// A message from the app's frame, checked before the parent acts on it: the tag, a numeric id, a known op and the
// fields that op needs. Anything else is ignored, never answered.
export function parseBridgeRequest(data: unknown): BridgeRequest | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.tag !== BRIDGE_TAG || typeof m.id !== "number" || !Number.isFinite(m.id) || typeof m.op !== "string" || !OPS.has(m.op)) return null;
  const id = m.id;
  if (m.op === "fetch") return parseFetch(m, id);
  if (m.op === "read") return parseRead(m, id);
  if (m.op === "requestSecret") return parseRequestSecret(m, id);
  if (m.op === "access") return { tag: BRIDGE_TAG, id, op: "access" };
  return { tag: BRIDGE_TAG, id, op: "env" };
}

function parseFetch(m: Record<string, unknown>, id: number): BridgeRequest | null {
  if (typeof m.url !== "string" || typeof m.method !== "string") return null;
  if (!m.headers || typeof m.headers !== "object" || Array.isArray(m.headers)) return null;
  const rawHeaders = m.headers as Record<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (typeof v !== "string") return null;
    headers[k] = v;
  }
  if (m.body !== undefined && typeof m.body !== "string") return null;
  return { tag: BRIDGE_TAG, id, op: "fetch", url: m.url, method: m.method, headers, body: m.body };
}

function parseRead(m: Record<string, unknown>, id: number): BridgeRequest | null {
  if (typeof m.name !== "string") return null;
  const args = m.args && typeof m.args === "object" && !Array.isArray(m.args) ? (m.args as Record<string, unknown>) : undefined;
  return { tag: BRIDGE_TAG, id, op: "read", name: m.name, args };
}

function parseRequestSecret(m: Record<string, unknown>, id: number): BridgeRequest | null {
  if (typeof m.name !== "string") return null;
  return { tag: BRIDGE_TAG, id, op: "requestSecret", name: m.name };
}
