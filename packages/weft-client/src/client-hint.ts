// Where a message came from, as the sender says it (docs/architecture/thread-env.md): the desktop board, weft.zip or
// the phone app, with a name and the sender's time zone. It rides on a cloud_commands row as payload.client and ends up
// in the <weft-env> block a thread reads on each turn.
//
// A HINT, never an authority: anyone holding the account's session can insert a row that says anything here. Nothing
// security-relevant may read it (no check, no grant, no mode); only the words the thread reads. Which host runs a card,
// who wrote the row and what it may do are decided elsewhere (lib/host/dispatch.ts, remoteRefusal).

export type ClientApp = "desktop" | "web" | "phone";

export interface ClientHint {
  app: ClientApp;
  // The Mac's name for a desktop board; free text, clipped.
  name?: string;
  // The sender's IANA time zone (Asia/Bangkok), for the user's local time.
  tz?: string;
  // How a desktop board reached a worker: its session line or the relay (a row).
  via?: "line" | "relay";
}

const APPS: readonly string[] = ["desktop", "web", "phone"];
const NAME_MAX = 40;
const TZ = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

// Printable text only, no markup or line breaks: it goes into a block the model reads.
function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.replace(/[^\p{L}\p{N} '._-]/gu, "").trim().slice(0, NAME_MAX);
  return name || undefined;
}

export function cleanTz(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length <= 64 && TZ.test(raw) ? raw : undefined;
}

/** A hint read off the network, every field checked; undefined when it names no known app. */
export function readClientHint(raw: unknown): ClientHint | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  if (typeof p.app !== "string" || !APPS.includes(p.app)) return undefined;
  const name = cleanName(p.name);
  const tz = cleanTz(p.tz);
  const via = p.via === "line" || p.via === "relay" ? p.via : undefined;
  return { app: p.app as ClientApp, ...(name && { name }), ...(tz && { tz }), ...(via && { via }) };
}

/** This runtime's time zone, from Intl (a browser's, a phone's, a Mac server's). */
export function ownTimeZone(): string | undefined {
  try {
    return cleanTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return undefined;
  }
}

/** A command row with the sender's hint on its payload. */
export function withClientHint<T extends { payload: unknown }>(row: T, hint: ClientHint): T {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return { ...row, payload: { ...payload, client: hint } };
}
