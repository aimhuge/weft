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
import type { CloudCardRow } from "./cloud-sync-types";
import { canonical, widenArgsOf, widenChangeOf, widenMessage, type WidenAuth, type WidenChange, type WidenVerb } from "./widen";
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
  // The card as this page read it itself (loadWidenCard), shown above the change.
  card?: WidenCard;
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

// The args this page sends, rebuilt from the change alone (and a "!" line's send-at time): nothing the board put in the
// link beside the change rides along unshown and unsigned. Null when the verb isn't one a passkey widens.
export function argsFromChange(verb: WidenVerb, change: WidenChange, given: Record<string, unknown>): Record<string, unknown> | null {
  if (verb === "card.update") return { body: { ...change } };
  if (verb === "card.shell") return { command: change.shell };
  if (verb !== "card.schedule") return null;
  const at = given.at;
  return typeof at === "number" && Number.isFinite(at) ? { text: change.schedule, at } : null;
}

// What the passkey signs for this ask, or why it can't.
export function widenToSign(ask: WidenAsk, passkey: { device: string; credId: string } | null, now: number, nonce = nonceNow(), card?: WidenCard): WidenToSign | string {
  if (!passkey) return "This browser hasn't paired a passkey with your Mac yet. On your Mac: Settings → Sync → Pair a passkey.";
  const change = widenChangeOf({ verb: ask.verb, args: { ...ask.args, id: ask.target.cardId } });
  if (!change) return "That change needs no approval: send it from the board.";
  if (change.permissionMode || change.readScope !== undefined) return PASSKEY_TOO_WIDE;
  const command = change.shell ?? change.schedule;
  if (command !== undefined && phoneOnly({ toolName: "Bash", input: { command } })) return PHONE_ONLY;
  const rebuilt = argsFromChange(ask.verb, change, ask.args);
  if (!rebuilt) return "That change can't be approved here.";
  const args = { ...rebuilt, id: ask.target.cardId };
  const host = hostOfDevice(ask.target.device);
  const message = widenMessage({ host, card: ask.target.cardId, verb: ask.verb, change, args: widenArgsOf(args), nonce, issuedAt: now });
  return { ...ask, args, host, change, card, message, device: passkey.device, credId: passkey.credId, issuedAt: now, nonce };
}

// The card as this page reads it with its own session, so the sheet names it by what you know it as rather than by
// ids a link chose. Refused when the account can't read it, it isn't on the host and folder the link names, or it's
// another account's.
export interface WidenCard {
  title: string;
  folder: string;
}

export async function loadWidenCard(client: SupabaseClient, ask: WidenAsk, userId: string): Promise<WidenCard | string> {
  const { data, error } = await client.from("cloud_cards").select("org_id, card_id, owner_device, owner_user, folder, card, deleted").eq("card_id", ask.target.cardId).overrideTypes<CloudCardRow[]>();
  if (error) return `That card couldn't be read: ${error.message}`;
  const t = ask.target;
  const row = data.find((r) => r.org_id === t.orgId && r.owner_device === t.device && r.folder === t.folder && !r.deleted);
  if (!row) return "That card isn't one of yours on that host.";
  if (row.owner_user && row.owner_user !== userId) return "That card is another account's: only its owner approves its changes.";
  const title = typeof row.card.title === "string" && row.card.title ? row.card.title : "(untitled)";
  return { title, folder: row.folder };
}

export const widenAuth = (w: WidenToSign, sig: PasskeySignature): WidenAuth => ({ kind: "webauthn", device: w.device, credId: w.credId, issuedAt: w.issuedAt, nonce: w.nonce, ...sig });

// Inserts the signed host command. Null once it's in, or why not.
export async function sendWiden(client: SupabaseClient, w: WidenToSign, sig: PasskeySignature): Promise<string | null> {
  const row = hostRow(w.target, w.verb as Parameters<typeof hostRow>[1], { ...w.args, widen: widenAuth(w, sig) });
  const { error } = await client.from("cloud_commands").insert(row);
  return error ? `The approval couldn't be sent: ${error.message}` : null;
}
