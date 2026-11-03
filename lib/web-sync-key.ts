// The web board's half of sealing (docs/architecture/mobile-security.md): a browser paired from Settings → Sync keeps
// its own keypairs in localStorage, reads its workspace_key_grants, and opens sealed rows in the page. The server never
// sees a key. A browser with no grant draws the 🔒 stand-ins. The ring is module state: the board loads it once on
// mount (loadWebKeyring) and then reopens what it already drew, so the server render and the first client render match.
import type { SupabaseClient } from "@supabase/supabase-js";
import { blobSealer } from "./blob-seal";
import type { BlobSeal, CloudCardRow, CloudThreadItemRow, CloudToolOutputRow } from "./cloud-sync-types";
import { makeClaim, parsePairingLink } from "./pairing-link";
import { b64, sodium, unb64, type Sodium } from "./sodium";
import type { BrowserPasskey } from "./web-passkey";
import { isSealed, openCard, openItem, openToolResult, SEALED_TEXT, type SyncKeyring } from "./sync-seal";
import type { ThreadItem } from "./types";

export const BROWSER_DEVICE_KEY = "weft-browser-device";

interface BrowserDevice {
  userId: string;
  deviceId?: string;
  boxPub: string;
  boxPriv: string;
  signPub: string;
  signPriv: string;
  // The passkey this browser paired with (lib/web-passkey.ts): it signs Allows, so the browser may approve.
  passkeyId?: string;
}

// sealedCards: the key version each card's row came sealed with, as it was drawn, so a file pasted into it goes up sealed
// with a key its host provably holds (webBlobSeal).
const state = { s: null as Sodium | null, ring: new Map<number, string>(), orgId: "", sealedCards: new Map<string, number>() };

function readDevice(userId: string): BrowserDevice | null {
  try {
    const saved = JSON.parse(localStorage.getItem(BROWSER_DEVICE_KEY) ?? "null") as BrowserDevice | null;
    return saved && saved.userId === userId ? saved : null;
  } catch {
    return null;
  }
}

const saveDevice = (d: BrowserDevice) => localStorage.setItem(BROWSER_DEVICE_KEY, JSON.stringify(d));

// Loads this browser's keys for the workspace. True when it now holds at least one.
export async function loadWebKeyring(client: SupabaseClient, orgId: string, userId: string): Promise<boolean> {
  const device = readDevice(userId);
  state.orgId = orgId;
  if (!device?.deviceId) return false;
  const s = (state.s ??= await sodium());
  const { data, error } = await client.from("workspace_key_grants").select("version, wrapped_key").eq("org_id", orgId).eq("device_id", device.deviceId);
  if (error) return false;
  for (const g of data as { version: number; wrapped_key: string }[]) {
    try {
      state.ring.set(g.version, b64(s, s.crypto_box_seal_open(unb64(s, g.wrapped_key), unb64(s, device.boxPub), unb64(s, device.boxPriv))));
    } catch {
      // A grant for other keys: nothing this browser can open.
    }
  }
  return state.ring.size > 0;
}

export const webKeyring = (): SyncKeyring => state.ring;

// This browser's paired device and passkey, when it paired with one: what signs an Allow on weft.zip.
export function browserPasskey(userId: string): { device: string; credId: string } | null {
  const device = readDevice(userId);
  return device?.deviceId && device.passkeyId ? { device: device.deviceId, credId: device.passkeyId } : null;
}

// The item a row holds, opened when sealed: a stand-in until this browser has the key.
export function openSyncedItem(row: Pick<CloudThreadItemRow, "card_id" | "seq" | "item"> & Partial<Pick<CloudThreadItemRow, "org_id" | "at">>): ThreadItem {
  if (!isSealed(row.item)) return row.item;
  const full = { org_id: row.org_id ?? state.orgId, at: row.at ?? "", ...row };
  if (!state.s) return { kind: "assistant", text: SEALED_TEXT, at: Date.parse(full.at) || 0 };
  return openItem(state.s, full, state.ring);
}

export function openSyncedCard<R extends Pick<CloudCardRow, "org_id" | "card_id" | "card">>(row: R): R {
  const sealed = (row.card as { sealed?: unknown }).sealed;
  if (isSealed(sealed)) state.sealedCards.set(row.card_id, sealed.v);
  else state.sealedCards.delete(row.card_id);
  if (!state.s) return row;
  const card = openCard(state.s, row, state.ring);
  return card === row.card ? row : { ...row, card };
}

// How a file pasted into `cardId` goes up (lib/web-upload.ts): sealed when the card's own row came sealed with a version
// this browser holds, since its host then opens it; plain otherwise (a worker's card, an unsealed or shared one, a new
// thread, a browser with no grant), as before sealing.
export function webBlobSeal(cardId: string | null | undefined): BlobSeal | null {
  const version = cardId ? state.sealedCards.get(cardId) : undefined;
  const key = version === undefined ? undefined : state.ring.get(version);
  return state.s && key && version !== undefined ? blobSealer(state.s, { version, key }) : null;
}

// The ready libsodium, once a keyring has loaded; what the board's blob viewers open sealed bytes with.
export const webSodium = (): Sodium | null => state.s;

export const openSyncedTool = (row: Pick<CloudToolOutputRow, "org_id" | "card_id" | "tool_id" | "result">) =>
  state.s ? openToolResult(state.s, row, state.ring) : row.result;

// This browser's new keypairs, and its passkey's id when it made one.
function newDevice(s: Sodium, user: { id: string; passkey?: BrowserPasskey | null }): BrowserDevice {
  const box = s.crypto_box_keypair();
  const sign = s.crypto_sign_keypair();
  const keys = { boxPub: b64(s, box.publicKey), boxPriv: b64(s, box.privateKey), signPub: b64(s, sign.publicKey), signPriv: b64(s, sign.privateKey) };
  return { userId: user.id, ...keys, ...(user.passkey ? { passkeyId: user.passkey.credId } : {}) };
}

// Pairs this browser with the Mac whose link it was given: makes its keys, writes the claim and waits for the Mac to
// confirm (Touch ID there), then keeps the device id. A browser reads sealed threads; one that pairs with a passkey
// (made by the page first, lib/web-passkey.ts) can also sign Allows with it, once the Mac has pinned it.
export async function pairThisBrowser(
  client: SupabaseClient,
  link: string,
  user: { id: string; name: string; passkey?: BrowserPasskey | null },
  wait: { tries?: number; everyMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<"paired" | "refused" | "expired"> {
  const parsed = parsePairingLink(link);
  if (!parsed) throw new Error("That pairing link isn't complete. Copy it again from Settings → Sync on your Mac.");
  const s = (state.s ??= await sodium());
  const device = newDevice(s, user);
  const { passkey } = user;
  const body = { name: user.name.slice(0, 80), platform: "web" as const, kind: "browser" as const, box_key: device.boxPub, sign_key: device.signPub, ...(passkey ? { passkey_id: passkey.credId, passkey_key: passkey.publicKey } : {}) };
  const claim = makeClaim(s, parsed, body, device.signPriv);
  const { error } = await client.from("phone_pairings").update({ ...claim, status: "claimed" }).eq("id", parsed.id).eq("status", "open");
  if (error) throw new Error(`The claim couldn't be sent: ${error.message}`);
  const { tries = 120, everyMs = 1000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = wait;
  for (let i = 0; i < tries; i++) {
    await sleep(everyMs);
    const { data } = await client.from("phone_pairings").select("status, device_id").eq("id", parsed.id).maybeSingle<{ status: string; device_id: string | null }>();
    if (data?.status === "paired" && data.device_id) {
      saveDevice({ ...device, deviceId: data.device_id });
      return "paired";
    }
    if (data?.status === "cancelled") return "refused";
  }
  return "expired";
}

// For tests: forget the loaded ring.
export function resetWebKeyring() {
  state.s = null;
  state.ring = new Map();
  state.orgId = "";
  state.sealedCards = new Map();
}
