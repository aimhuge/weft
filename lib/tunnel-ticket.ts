import { createHmac, timingSafeEqual } from "node:crypto";

// Tunnel tickets (docs/architecture/tunnels.md). A quick tunnel's URL is public to anyone holding it, so the local gate
// (lib/tunnel-gate.ts) lets nothing through without a ticket. The stable address on the deployed Weft signs one after
// it has checked who's asking, with a secret the Mac made for this tunnel. Enter tickets let a signed-in browser in;
// forward tickets carry one webhook delivery, bound to its method and path, so neither can stand in for the other.

export const TICKET_TTL_MS = 60_000;
export const FORWARD_HEADER = "x-weft-forward";

type Purpose = "enter" | "forward";

function mac(secret: string, tunnelId: string, purpose: Purpose, exp: number, scope: string) {
  return createHmac("sha256", secret).update(`${tunnelId}\n${purpose}\n${exp}\n${scope}`).digest("hex");
}

function sign(secret: string, tunnelId: string, purpose: Purpose, scope: string, now: number) {
  const exp = now + TICKET_TTL_MS;
  return `${exp}.${mac(secret, tunnelId, purpose, exp, scope)}`;
}

function verify(ticket: string, secret: string, tunnelId: string, purpose: Purpose, scope: string, now: number) {
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(ticket);
  if (!match) return false;
  const exp = Number(match[1]);
  // A later expiry than signing could give can only be forged, so it's refused along with a past one.
  if (exp <= now || exp > now + TICKET_TTL_MS) return false;
  return timingSafeEqual(Buffer.from(match[2] ?? "", "hex"), Buffer.from(mac(secret, tunnelId, purpose, exp, scope), "hex"));
}

export const enterTicket = (secret: string, tunnelId: string, now = Date.now()) => sign(secret, tunnelId, "enter", "", now);
export const verifyEnter = (ticket: string, secret: string, tunnelId: string, now = Date.now()) => verify(ticket, secret, tunnelId, "enter", "", now);

const forwardScope = (method: string, path: string) => `${method.toUpperCase()} ${path}`;
export const forwardTicket = (secret: string, tunnelId: string, method: string, path: string, now = Date.now()) => sign(secret, tunnelId, "forward", forwardScope(method, path), now);
export const verifyForward = (ticket: string, secret: string, tunnelId: string, method: string, path: string, now = Date.now()) =>
  verify(ticket, secret, tunnelId, "forward", forwardScope(method, path), now);
