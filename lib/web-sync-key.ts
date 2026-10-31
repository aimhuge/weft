// The web board's half of sealing (docs/architecture/mobile-security.md): a browser paired from Settings → Sync keeps
// its own keypairs in localStorage, reads its workspace_key_grants, and opens sealed rows in the page. The server never
// sees a key. A browser with no grant draws the 🔒 stand-ins. The ring is module state: the board loads it once on
// mount (loadWebKeyring) and then reopens what it already drew, so the server render and the first client render match.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudCardRow, CloudThreadItemRow, CloudToolOutputRow } from "./cloud-sync-types";
import { makeClaim, parsePairingLink } from "./pairing-link";
import { b64, sodium, unb64, type Sodium } from "./sodium";
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
}

const state = { s: null as Sodium | null, ring: new Map<number, string>(), orgId: "" };

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

// The item a row holds, opened when sealed: a stand-in until this browser has the key.
export function openSyncedItem(row: Pick<CloudThreadItemRow, "card_id" | "seq" | "item"> & Partial<Pick<CloudThreadItemRow, "org_id" | "at">>): ThreadItem {
  if (!isSealed(row.item)) return row.item;
  const full = { org_id: row.org_id ?? state.orgId, at: row.at ?? "", ...row };
  if (!state.s) return { kind: "assistant", text: SEALED_TEXT, at: Date.parse(full.at) || 0 };
  return openItem(state.s, full, state.ring);
}

export function openSyncedCard<R extends Pick<CloudCardRow, "org_id" | "card_id" | "card">>(row: R): R {
  if (!state.s) return row;
  const card = openCard(state.s, row, state.ring);
  return card === row.card ? row : { ...row, card };
}

export const openSyncedTool = (row: Pick<CloudToolOutputRow, "org_id" | "card_id" | "tool_id" | "result">) =>
  state.s ? openToolResult(state.s, row, state.ring) : row.result;

// Pairs this browser with the Mac whose link it was given: makes its keys, writes the claim and waits for the Mac to
// confirm (Touch ID there), then keeps the device id. A browser reads sealed threads but never approves.
export async function pairThisBrowser(
  client: SupabaseClient,
  link: string,
  user: { id: string; name: string },
  wait: { tries?: number; everyMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<"paired" | "refused" | "expired"> {
  const parsed = parsePairingLink(link);
  if (!parsed) throw new Error("That pairing link isn't complete. Copy it again from Settings → Sync on your Mac.");
  const s = (state.s ??= await sodium());
  const box = s.crypto_box_keypair();
  const sign = s.crypto_sign_keypair();
  const device: BrowserDevice = { userId: user.id, boxPub: b64(s, box.publicKey), boxPriv: b64(s, box.privateKey), signPub: b64(s, sign.publicKey), signPriv: b64(s, sign.privateKey) };
  const claim = makeClaim(s, parsed, { name: user.name.slice(0, 80), platform: "web", kind: "browser", box_key: device.boxPub, sign_key: device.signPub }, device.signPriv);
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
}
