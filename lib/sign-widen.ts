// A widening approved with a passkey on sign.weft.zip (docs/architecture/project-hosts.md#signed-widening-as-built):
// what the approve page does for `?widen=…`, apart from drawing (lib/sign-widen-sheet.ts). The weft.zip board names the
// host verb it wants (a card's new folder or agent, a "!" line, one to send later) and where it runs; this page shows
// every field it will sign, signs the widening message (lib/widen.ts) with the passkey, and inserts the `host` command
// itself. The board can ask for anything, but nothing is signed that the sheet didn't show, and the host rebuilds the
// message from its own names, so a request bent on the way signs nothing it will run.
import type { SupabaseClient } from "@supabase/supabase-js";
import { hostRow, type CardTarget } from "./host-row";
import { isHostVerb } from "@weft/client";
import { phoneOnly, PHONE_ONLY } from "./passkey-phone-only";
import type { PasskeySignature } from "./web-passkey";
import { canonical, widenChangeOf, widenMessage, type WidenAuth, type WidenChange, type WidenVerb } from "./widen";
import { PASSKEY_TOO_WIDE } from "./widen-check";

// What weft.zip asks the page to sign: the row's target and the verb with its args, as the board would have sent them.
export interface WidenAsk {
  target: CardTarget;
  verb: WidenVerb;
  args: Record<string, unknown>;
}

export interface WidenToSign extends WidenAsk {
  host: string;
  change: WidenChange;
  message: string;
  device: string;
  credId: string;
  issuedAt: number;
  nonce: string;
}

const PARAM = "widen";
const ID = /^[A-Za-z0-9_:.-]{1,200}$/;

// The approve page's link for one widening (a new top-level tab, as for an answer).
export function signWidenUrl(origin: string, ask: WidenAsk): string {
  const packed = btoa(String.fromCharCode(...new TextEncoder().encode(canonical(ask)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${origin}/approve?${new URLSearchParams({ [PARAM]: packed }).toString()}`;
}

// The ask off the page's URL, or null when there's none or it isn't whole.
export function widenAskOf(search: string): WidenAsk | null {
  const packed = new URLSearchParams(search).get(PARAM);
  if (!packed) return null;
  try {
    const bytes = Uint8Array.from(atob(packed.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<WidenAsk>;
    const t = raw.target;
    if (!t || ![t.orgId, t.device, t.cardId].every((v) => typeof v === "string" && ID.test(v)) || typeof t.folder !== "string") return null;
    if (typeof raw.verb !== "string" || !isHostVerb(raw.verb) || !raw.args || typeof raw.args !== "object") return null;
    return { target: { orgId: t.orgId, device: t.device, folder: t.folder, cardId: t.cardId }, verb: raw.verb, args: raw.args };
  } catch {
    return null;
  }
}

// The host a row's target names: a worker's id (`worker:<id>`), or a Mac's device id.
export const hostOfDevice = (device: string) => (device.startsWith("worker:") ? device.slice("worker:".length) : device);

const nonceNow = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// What the passkey signs for this ask, or why it can't.
export function widenToSign(ask: WidenAsk, passkey: { device: string; credId: string } | null, now: number, nonce = nonceNow()): WidenToSign | string {
  if (!passkey) return "This browser hasn't paired a passkey with your Mac yet. On your Mac: Settings → Sync → Pair a passkey.";
  const args = { ...ask.args, id: ask.target.cardId };
  const change = widenChangeOf({ verb: ask.verb, args });
  if (!change) return "That change needs no approval: send it from the board.";
  if (change.permissionMode || change.readScope !== undefined) return PASSKEY_TOO_WIDE;
  const command = change.shell ?? change.schedule;
  if (command !== undefined && phoneOnly({ toolName: "Bash", input: { command } })) return PHONE_ONLY;
  const host = hostOfDevice(ask.target.device);
  const message = widenMessage({ host, card: ask.target.cardId, verb: ask.verb, change, nonce, issuedAt: now });
  return { ...ask, args, host, change, message, device: passkey.device, credId: passkey.credId, issuedAt: now, nonce };
}

export const widenAuth = (w: WidenToSign, sig: PasskeySignature): WidenAuth => ({ kind: "webauthn", device: w.device, credId: w.credId, issuedAt: w.issuedAt, nonce: w.nonce, ...sig });

// Inserts the signed host command. Null once it's in, or why not.
export async function sendWiden(client: SupabaseClient, w: WidenToSign, sig: PasskeySignature): Promise<string | null> {
  const row = hostRow(w.target, w.verb as Parameters<typeof hostRow>[1], { ...w.args, widen: widenAuth(w, sig) });
  const { error } = await client.from("cloud_commands").insert(row);
  return error ? `The approval couldn't be sent: ${error.message}` : null;
}
