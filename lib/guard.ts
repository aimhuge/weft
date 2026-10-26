import crypto from "node:crypto";
import { shellToken } from "./shell-token";

// The API can start agents with shell access, so only this machine's own pages may call it.
// The Host check blocks DNS rebinding; the custom header makes cross-site POSTs fail CORS preflight.
// Once the desktop app has launched a token, EVERY route needs it — writes, sensitive reads and ordinary reads
// alike. A process that only reaches the port (a browser extension, a malicious postinstall, any local app) must
// not be able to read the board, its project paths or the names of the secrets in the vault. The desktop app
// swaps the board window's x-weft-token for the launch token on all of its own requests
// (electron/api-token.cjs), so the board keeps working and a thread's plain `1` still works for reads and
// non-elevated writes. With no token on disk the API fails closed: a missing or unreadable file must not open
// it up. Electron main writes the token before it starts the server (electron/main.cjs `boot`), so first launch
// has one. Only tests and a server started with WEFT_NO_TOKEN=1 (`pnpm dev` in a plain browser) run without.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function tokenOptional(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VITEST) || env.WEFT_NO_TOKEN === "1";
}

function hasToken(req: Request, requireOne = false): boolean {
  const want = shellToken();
  if (!want) return !requireOne && tokenOptional();
  const got = req.headers.get("x-weft-token") ?? "";
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// `sensitive` is gone: once a launch token exists every route needs it, so the flag no longer changed the
// verdict. The six routes that passed it (`account`, `account/billing`, `account/team`, `github/collaborators`,
// `services`, `settings`) now get the same check from the line below.
export function guard(req: Request, { write = true }: { write?: boolean } = {}): Response | null {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) return Response.json({ error: "Forbidden host" }, { status: 403 });
  // The desktop app swaps the board window's x-weft-token for the launch token, so a write carries "1" or that token.
  const sent = req.headers.get("x-weft-token");
  if (write && sent !== "1" && !(sent && hasToken(req, true))) {
    return Response.json({ error: "Missing x-weft-token header" }, { status: 403 });
  }
  // Once a launch token exists, a read needs it too — the plain "1" is enough for the board and for a thread's
  // curl, but a process that never went through the desktop app has no token to send at all.
  if (sent !== "1" && !hasToken(req)) return Response.json({ error: "Missing token" }, { status: 403 });
  return null;
}

// Writes that grant power (answer a permission prompt, change settings, allow a folder, loosen a card's mode,
// run a shell command) need the launch token itself, not the "1" a thread's curl may send for ordinary board
// moves (lib/sprint-plan.ts, lib/commit-pile.ts). The desktop app puts the token on every board-window request.
export function elevated(req: Request): Response | null {
  const denied = guard(req);
  if (denied) return denied;
  if (!hasToken(req)) return Response.json({ error: "This change needs Weft's own window" }, { status: 403 });
  return null;
}

export function fail(err: unknown, status = 400) {
  return Response.json({ error: errorMessage(err) }, { status });
}

// Supabase and Stripe errors are often plain objects with a message, not Errors;
// String() would make those "[object Object]".
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}
