// Passkey approvals from a paired browser on weft.zip (docs/architecture/mobile-security.md, "Passkey approvals"). The
// browser signs with a WebAuthn passkey the host pinned at pairing; the challenge is base64url(SHA-256(this message)).
//
// The message is its own encoding, not the phone's newline-joined one (lib/approval-sig.ts stays byte for byte as it
// was): canonical JSON (keys sorted at every depth) of one fixed set of fields, so no value can forge another field, and
// readPasskeyMessage takes back only that exact shape, re-encoded byte for byte. It carries the whole tool input, so the
// approval sheet shows everything the signature covers. Id fields refuse control characters outright.
import type { ApprovalFields } from "./approval-sig";
import type { GrantScope } from "./cloud-commands";
import type { PendingPermission } from "./types";

export const PASSKEY_MESSAGE_V = "weft-passkey-approval-v1";

// What rides beside the answer payload (cloud_commands.payload.auth) when a browser signed it. Every byte part base64url.
export interface PasskeyAuth {
  kind: "webauthn";
  // public.devices.id of the browser, and its passkey's credential id.
  device: string;
  credId: string;
  issuedAt: number;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

// The tool and its input, and the card's folder (shown on the sheet, from the Mac's own card on the host side).
export type PasskeyAction = Pick<PendingPermission, "toolName" | "input"> & { folder?: string };

// The signed body. Every key is always present (null when unset), so there is one encoding per approval.
export interface PasskeyMessage {
  v: typeof PASSKEY_MESSAGE_V;
  org: string;
  mac: string;
  card: string;
  pending: string;
  decision: "allow" | "deny";
  issuedAt: number;
  answers: Record<string, string> | null;
  folder: string | null;
  grant: GrantScope | null;
  tool: string;
  input: Record<string, unknown>;
}

const KEYS = ["answers", "card", "decision", "folder", "grant", "input", "issuedAt", "mac", "org", "pending", "tool", "v"];

// Keys sorted at every depth, after a JSON round trip, so the browser and the Mac encode the same bytes.
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sorted(obj[k])]));
  }
  return value;
}

export const canonicalJson = (value: unknown) => JSON.stringify(sorted(JSON.parse(JSON.stringify(value ?? {}))));

// Bidi overrides and isolates: they can make a command read differently from what it is.
export const BIDI = /[\u202a-\u202e\u2066-\u2069]/;
export const BIDI_REFUSED = "That request has text-direction characters that can make it read differently than it runs, so approve it on your phone or this Mac.";
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
// Invisible or blank-looking characters: format characters (bidi, zero-width, BOM), line and paragraph separators, and
// the letters that draw as nothing (Hangul fillers, the braille blank). None belongs in an id, a tool name or a folder.
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}\u115f\u1160\u2800\u3164\uffa0]/u;
const clean = (text: string, max = 200) => text.length > 0 && text.length <= max && !CONTROL.test(text) && !INVISIBLE.test(text);
const cleanFolder = (folder: unknown) => folder === null || (typeof folder === "string" && clean(folder, 1000) && !BIDI.test(folder));

// The message a passkey signs, or a throw when an id field isn't a clean single token.
export function passkeyMessage(fields: ApprovalFields, action: PasskeyAction): string {
  const ids = [fields.orgId, fields.macDevice, fields.cardId, fields.pendingId, action.toolName];
  if (!ids.every((id) => clean(id)) || !cleanFolder(action.folder ?? null)) throw new Error("That approval names a device, card or tool with characters it can't carry.");
  const body: PasskeyMessage = {
    v: PASSKEY_MESSAGE_V,
    org: fields.orgId,
    mac: fields.macDevice,
    card: fields.cardId,
    pending: fields.pendingId,
    decision: fields.allow ? "allow" : "deny",
    issuedAt: fields.issuedAt,
    answers: fields.answers && Object.keys(fields.answers).length ? fields.answers : null,
    folder: action.folder ?? null,
    grant: fields.grant ?? null,
    tool: action.toolName,
    input: action.input,
  };
  return canonicalJson(body);
}

const isStringMap = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");

function wellFormed(m: Record<string, unknown>): boolean {
  if (m.v !== PASSKEY_MESSAGE_V || (m.decision !== "allow" && m.decision !== "deny") || typeof m.issuedAt !== "number") return false;
  if (![m.org, m.mac, m.card, m.pending, m.tool].every((x) => typeof x === "string" && clean(x)) || !cleanFolder(m.folder)) return false;
  if (m.grant !== null && m.grant !== "card" && m.grant !== "always") return false;
  if (m.answers !== null && !isStringMap(m.answers)) return false;
  return !!m.input && typeof m.input === "object" && !Array.isArray(m.input);
}

// The message back, only when it is exactly one this module makes: the fixed keys, the right types, clean ids, and
// canonical bytes (so a duplicated key or extra whitespace is refused). Null for anything else; the sheet then signs nothing.
export function readPasskeyMessage(message: string): PasskeyMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const m = parsed as Record<string, unknown>;
  if (Object.keys(m).sort().join() !== KEYS.join() || !wellFormed(m)) return null;
  return canonicalJson(m) === message ? (m as unknown as PasskeyMessage) : null;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

// The auth off the network: a passkey's, each field the type and shape it must be, or null.
export function readPasskeyAuth(raw: unknown): PasskeyAuth | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.kind !== "webauthn" || typeof a.issuedAt !== "number") return null;
  const { device, credId, authenticatorData, clientDataJSON, signature } = a;
  const parts = [device, credId, authenticatorData, clientDataJSON, signature];
  if (!parts.every((p) => typeof p === "string" && p.length > 0 && p.length <= 4096)) return null;
  if (![credId, authenticatorData, clientDataJSON, signature].every((p) => B64URL.test(p as string))) return null;
  return { kind: "webauthn", device, credId, issuedAt: a.issuedAt, authenticatorData, clientDataJSON, signature } as PasskeyAuth;
}
