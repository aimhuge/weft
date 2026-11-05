import http from "node:http";
import net from "node:net";
import { randomBytes } from "node:crypto";
import type { AddressInfo, Socket } from "node:net";
import { FORWARD_HEADER, verifyEnter, verifyForward } from "./tunnel-ticket";

// The local gate (docs/architecture/tunnels.md): what cloudflared points at, in front of a dev server. A quick tunnel
// has no sign-in and anyone with its URL can reach it, so this is the only thing keeping a tunnel private. Nothing
// passes without a ticket from the stable address (lib/tunnel-ticket.ts) or the session cookie one buys. It rewrites
// Host and Origin to the target's own, because dev servers refuse a hostname that changes on every start.

export const ENTER_PATH = "/__weft/enter";
const COOKIE = "weft_gate";
export const SESSION_MS = 12 * 60 * 60 * 1000;

export interface GateOptions {
  tunnelId: string;
  secret: string;
  target: string;
  // Weft's own port, which a tunnel must never reach: it's the board's API.
  weftPort?: number;
  now?: () => number;
}

// Never reach the dev server: the gate's own headers, and the local API's write header, which a stranger must never supply.
const DROPPED = new Set(["x-weft-token", FORWARD_HEADER, "connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding"]);

// A tunnel's target: an http URL on this Mac, and never Weft itself.
export function cleanGateTarget(raw: string, weftPort?: number): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:") throw new Error("A tunnel's target is an http URL on this Mac.");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("A tunnel's target is on this Mac (localhost).");
  const port = Number(url.port || 80);
  if (weftPort && port === weftPort) throw new Error("A tunnel can't open Weft's own port: it's the board's API.");
  return url;
}

// Only a path on this site, so a crafted next can't send a visitor elsewhere after sign-in.
export function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : "/";
}

function sessionOf(cookie: string | undefined) {
  for (const part of (cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

function withoutGateCookie(cookie: string) {
  return cookie.split(";").map((p) => p.trim()).filter((p) => p && !p.startsWith(`${COOKIE}=`)).join("; ");
}

// What the dev server gets: the request as it would be on localhost, with the gate's traces gone.
export function upstreamHeaders(headers: http.IncomingHttpHeaders, target: URL) {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) if (value !== undefined && !DROPPED.has(name)) out[name] = value;
  out.host = target.host;
  if (out.origin) out.origin = target.origin;
  const cookie = typeof out.cookie === "string" ? withoutGateCookie(out.cookie) : "";
  if (cookie) out.cookie = cookie;
  else delete out.cookie;
  return out;
}

// A redirect to the target's own origin would send the visitor to their own localhost.
export function publicLocation(location: string, target: URL) {
  return location.startsWith(target.origin) ? location.slice(target.origin.length) || "/" : location;
}

const refuse = (res: http.ServerResponse, status: number, body: string) => {
  res.writeHead(status, { "content-type": "text/plain", "cache-control": "no-store" });
  res.end(body);
};

export async function startGate(opts: GateOptions) {
  const target = cleanGateTarget(opts.target, opts.weftPort);
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, number>();
  const usedTickets = new Set<string>();

  const validSession = (cookie: string | undefined) => {
    const id = sessionOf(cookie);
    const expires = id ? sessions.get(id) : undefined;
    if (!id || !expires) return false;
    if (expires > now()) return true;
    sessions.delete(id);
    return false;
  };

  function enter(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const ticket = url.searchParams.get("ticket") ?? "";
    // A ticket buys one session: one read from a log or a referrer can't buy another.
    if (usedTickets.has(ticket) || !verifyEnter(ticket, opts.secret, opts.tunnelId, now())) {
      refuse(res, 403, "This link has expired. Open the tunnel's address again.");
      return;
    }
    usedTickets.add(ticket);
    const id = randomBytes(32).toString("hex");
    sessions.set(id, now() + SESSION_MS);
    res.writeHead(302, {
      location: safeNext(url.searchParams.get("next")),
      "set-cookie": `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`,
      "cache-control": "no-store",
    });
    res.end();
  }

  function pass(req: http.IncomingMessage, res: http.ServerResponse) {
    const upstream = http.request({ host: target.hostname.replace(/[[\]]/g, ""), port: target.port || 80, method: req.method, path: req.url, headers: upstreamHeaders(req.headers, target) }, (answer) => {
      const headers = { ...answer.headers };
      if (typeof headers.location === "string") headers.location = publicLocation(headers.location, target);
      res.writeHead(answer.statusCode ?? 502, headers);
      answer.pipe(res);
    });
    upstream.on("error", () => (res.headersSent ? res.destroy() : refuse(res, 502, "The dev server isn't answering.")));
    req.pipe(upstream);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://gate");
    if (url.pathname === ENTER_PATH) {
      enter(req, res, url);
      return;
    }
    const forward = req.headers[FORWARD_HEADER];
    const forwarded = typeof forward === "string" && !usedTickets.has(forward) && verifyForward(forward, opts.secret, opts.tunnelId, req.method ?? "", req.url ?? "", now());
    if (forwarded) usedTickets.add(forward);
    if (forwarded || validSession(req.headers.cookie)) pass(req, res);
    else refuse(res, 401, "This tunnel is private. Open it through its Weft address.");
  });

  // WebSockets, for hot reload: the same check, then the bytes run straight through.
  server.on("upgrade", (req, socket: Socket, head: Buffer) => {
    if (!validSession(req.headers.cookie)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = net.connect(Number(target.port || 80), target.hostname.replace(/[[\]]/g, ""), () => {
      const headers = upstreamHeaders(req.headers, target);
      headers.connection = "Upgrade";
      const lines = Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${String(v)}`]));
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
