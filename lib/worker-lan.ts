// A Weft Worker's LAN port (docs/architecture/weft-worker.md#the-lan-path): a board's Mac on the same network posts the
// session line's sealed offer here, found through the signed mDNS hint (lib/worker-lan-advert.ts), and gets the sealed
// answer back in the reply, so opening a line needs no Supabase round trip. The line itself is the same one a `line`
// row opens (lib/host-line.ts), its verbs on the same `host` path.
//
// The port is open to the whole LAN, so it trusts nothing it reads before the checks, in this order (cheapest first):
//   rate      LAN_RATE per address and in all, before the body is read; at most MAX_OPENING offers being answered at once
//   size      MAX_BODY bytes, by Content-Length and while streaming; a slow sender is cut off at HEADERS_MS / BODY_MS
//   shape     readLanOffer: a whole offer, for this worker's id
//   Mac       signed by a Mac key this box pinned from its pairing code (lib/worker-mac-keys.ts), over this offer's own
//             digest, within OFFER_MAX_SKEW_MS of this box's clock, its nonce never seen before (kept on disk)
//   seal      the offer opens with this box's key for LINE_PURPOSE (lib/host-line.ts), or the line isn't opened
// Every refusal past the shape answers the same 403, so a prober learns nothing about which check it failed.
import http from "node:http";
import { LAN_PATH, lanOfferMessage, offerDigest, OFFER_MAX_SKEW_MS, readLanOffer } from "./lan-hint";
import { LAN_RATE, rateLimiter, type RateLimit } from "./lan-rate";
import type { SealedAnswer } from "./rtc-signal";
import type { NonceBook } from "./widen-nonces";
import { macSigned } from "./worker-mac-keys";
import type { Sealed } from "./worker-seal";

export const MAX_BODY = 64 * 1024;
export const MAX_OPENING = 2;
export const ANSWER_MS = 15_000;
const HEADERS_MS = 5_000;
const BODY_MS = 10_000;

export interface LanServerDeps {
  workerId: string;
  // The Mac keys this box pinned from its pairing code; none, and every offer is refused.
  macKeys: () => string[];
  nonces: NonceBook;
  // Opens the line from the sealed offer and resolves with its sealed answer (lib/worker-daemon.ts lanLine).
  open: (sealed: Sealed) => Promise<SealedAnswer>;
  now?: () => number;
  log?: (msg: string) => void;
  limit?: RateLimit;
  answerMs?: number;
}

export type LanReply = { status: number; body: Record<string, unknown> };
const reply = (status: number, error?: string, extra: Record<string, unknown> = {}): LanReply => ({ status, body: { ...(error ? { error } : {}), ...extra } });
const REFUSED = reply(403, "refused");

// Whether a parsed offer is from a Mac this box trusts, fresh and never seen; takes the nonce when it is.
async function fromPinnedMac(deps: LanServerDeps, offer: NonNullable<ReturnType<typeof readLanOffer>>, now: number): Promise<boolean> {
  const { mac, sealed } = offer;
  if (!deps.macKeys().includes(mac.key)) return false;
  if (Math.abs(now - mac.issuedAt) > OFFER_MAX_SKEW_MS) return false;
  if (!macSigned(mac.key, lanOfferMessage(offer.workerId, mac.issuedAt, mac.nonce, offerDigest(sealed)), mac.sig)) return false;
  return deps.nonces.take(mac.nonce, mac.issuedAt + 2 * OFFER_MAX_SKEW_MS, mac.issuedAt);
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("The line didn't answer in time.")), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// One posted body, after the rate and size checks: the reply to send.
export async function handleLanOffer(deps: LanServerDeps, text: string): Promise<LanReply> {
  const log = deps.log ?? (() => {});
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return reply(400, "bad offer");
  }
  const offer = readLanOffer(raw);
  if (!offer) return reply(400, "bad offer");
  if (offer.workerId !== deps.workerId.toLowerCase()) return REFUSED;
  if (!(await fromPinnedMac(deps, offer, (deps.now ?? Date.now)()))) {
    log("Weft Worker: refused a LAN offer that isn't from this box's Mac");
    return REFUSED;
  }
  try {
    const answer = await within(deps.open(offer.sealed), deps.answerMs ?? ANSWER_MS);
    log("Weft Worker: a board opened a line over the LAN");
    return reply(200, undefined, { answer });
  } catch (err) {
    log(`Weft Worker: a LAN offer didn't open: ${(err as Error).message}`);
    return reply(503, "no line");
  }
}

function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

function send(res: http.ServerResponse, r: LanReply) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(r.status, { "content-type": "application/json", connection: "close" });
  res.end(JSON.stringify(r.body));
}

export function createLanServer(deps: LanServerDeps) {
  const allow = rateLimiter(deps.limit ?? LAN_RATE, deps.now);
  let opening = 0;
  // The refusal for a request before its body is read, or null to read it.
  function early(req: http.IncomingMessage): LanReply | null {
    if (req.url !== LAN_PATH) return reply(404, "not here");
    if (req.method !== "POST") return reply(405, "post only");
    if (!allow(String(req.socket.remoteAddress)) || opening >= MAX_OPENING) return reply(429, "slow down");
    return Number(req.headers["content-length"] ?? 0) > MAX_BODY ? reply(413, "too big") : null;
  }
  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const refused = early(req);
    if (refused) {
      send(res, refused);
      return;
    }
    opening += 1;
    try {
      const body = await readBody(req);
      send(res, body === null ? reply(413, "too big") : await handleLanOffer(deps, body));
    } finally {
      opening -= 1;
    }
  }
  const server = http.createServer((req, res) => void handle(req, res));
  server.headersTimeout = HEADERS_MS;
  server.requestTimeout = BODY_MS + (deps.answerMs ?? ANSWER_MS);
  server.maxHeadersCount = 20;
  server.maxConnections = 16;
  return {
    // Resolves with the port it took (0 asks for any free one).
    listen: (port: number, host: string) =>
      new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve((server.address() as { port: number }).port));
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
