// Offering a session line straight to a worker on the same LAN (docs/architecture/weft-worker.md#the-lan-path), from
// this Mac's server, before the Supabase `line` row (lib/worker-board.ts openWorkerLine):
//
//   1. main's pins for the worker (electron/lan-line-sign.cjs): the sign key and box key it pinned at pairing. None (a
//      token-enrolled worker, or one re-pinned since) and there's no LAN path.
//   2. a hint for it off mDNS (lib/lan-mdns.ts) that checks against those pins and is fresh (lib/lan-hint.ts hintChecks)
//   3. the board's offer sealed to the pinned box key (LINE_PURPOSE), and main's signature over its digest
//   4. POST http://<address>:<port>/line; the reply's sealed answer goes back to the board, which opens it with its
//      one-time key as it would one off Broadcast (lib/session-line.ts)
// Any step that fails answers null and the row goes as before: Supabase stays the fallback.
import { LAN_PATH, offerDigest, hintChecks, type MacStamp } from "./lan-hint";
import { createLanBrowser, type LanBrowser, type MdnsLike } from "./lan-mdns";
import { LINE_PURPOSE, type LineOffer } from "./host-line-protocol";
import type { SealedAnswer } from "./rtc-signal";
import { seal } from "./worker-seal";
import { shell } from "./browser-shell";
import makeMdns from "multicast-dns";

export const HINT_WAIT_MS = 400;
export const POST_MS = 8_000;
const MAX_REPLY = 16 * 1024;

export interface LanOfferDeps {
  keys(workerId: string): Promise<{ signKey: string; boxKey: string } | null>;
  sign(workerId: string, digest: string): Promise<MacStamp>;
  browser(): LanBrowser | null;
  post(url: string, body: unknown, ms: number): Promise<unknown>;
  now?: () => number;
  log?: (msg: string) => void;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

// The worker's reply read as a sealed answer, or null.
export function answerOf(v: unknown): SealedAnswer | null {
  const a = v && typeof v === "object" ? (v as { answer?: unknown }).answer : null;
  if (!a || typeof a !== "object") return null;
  const { iv, ct } = a as Record<string, unknown>;
  return typeof iv === "string" && typeof ct === "string" && B64.test(iv) && B64.test(ct) && iv.length <= 32 && ct.length <= MAX_REPLY ? { iv, ct } : null;
}

// The sealed answer from the worker over the LAN, or null to take the Supabase row instead.
export async function offerOverLan(workerId: string, offer: LineOffer, deps: LanOfferDeps): Promise<SealedAnswer | null> {
  const now = deps.now ?? Date.now;
  try {
    // main first: off the desktop (no control server) this throws before any socket is opened.
    const keys = await deps.keys(workerId);
    const browser = keys && deps.browser();
    if (!keys || !browser) return null;
    const pinned = { workerId, ...keys };
    const found = await browser.candidate(workerId, (c) => hintChecks(c.hint, pinned, now()), HINT_WAIT_MS);
    if (!found) return null;
    const { sdp, key, topic, ice } = offer;
    const sealed = seal(keys.boxKey, JSON.stringify({ sdp, key, topic, ice }), LINE_PURPOSE);
    const mac = await deps.sign(workerId, offerDigest(sealed));
    const host = found.address.includes(":") ? `[${found.address}]` : found.address;
    const answer = answerOf(await deps.post(`http://${host}:${found.hint.port}${LAN_PATH}`, { v: 1, workerId, sealed, mac }, POST_MS));
    if (!answer) throw new Error("its reply carried no answer");
    deps.log?.(`Weft: opened a line to ${workerId} over the LAN (${found.address})`);
    return answer;
  } catch (err) {
    deps.log?.(`Weft: no LAN line to ${workerId}, using the relay: ${(err as Error).message}`);
    return null;
  }
}

// The real wiring: main through the control server, multicast-dns once per server process, fetch with a timeout.
type Shell = (route: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
type MakeMdns = () => MdnsLike;

let shared: LanBrowser | undefined;

export function realLanDeps(shell: Shell, mdns: MakeMdns, env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): LanOfferDeps {
  return {
    async keys(workerId) {
      const r = await shell("/lan-line/keys", { workerId });
      return typeof r.signKey === "string" && typeof r.boxKey === "string" ? { signKey: r.signKey, boxKey: r.boxKey } : null;
    },
    sign: async (workerId, digest) => (await shell("/lan-line/sign", { workerId, digest })) as unknown as MacStamp,
    browser() {
      if (env.WEFT_LAN === "0") return null;
      return (shared ??= createLanBrowser(mdns()));
    },
    async post(url, body, ms) {
      const res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms), redirect: "error" });
      if (!res.ok) throw new Error(`the worker said ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_REPLY * 2) throw new Error("its reply was too big");
      return JSON.parse(text) as unknown;
    },
    log: (msg) => console.log(msg),
  };
}

let real: LanOfferDeps | undefined;

// The LAN answer for a board's offer, or null: what openWorkerLine tries before the row.
export function lanAnswer(workerId: string, offer: LineOffer): Promise<SealedAnswer | null> {
  real ??= realLanDeps(shell, () => makeMdns() as unknown as MdnsLike);
  return offerOverLan(workerId, offer, real);
}

// Closes the shared browser (tests, and a server shutting down).
export function closeLanBrowser() {
  shared?.close();
  shared = undefined;
}
