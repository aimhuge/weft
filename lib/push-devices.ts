// Settings → Sync → Phones: the phones signed in to your Weft account that get a push when a synced card needs
// you or is ready for review (docs/architecture/mobile.md#push). The rows live in public.push_devices
// (supabase/migrations/20261029104224_push_devices.sql); the phone app registers itself, and RLS lets you read and
// remove only your own. Read with the account's client, signed in as you (lib/account.ts accountClient).
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";

export interface PushDevice {
  id: string;
  platform: "ios" | "android";
  deviceName: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface PushDevicesView {
  signedIn: boolean;
  devices: PushDevice[];
}

interface Row {
  id: string;
  platform: "ios" | "android";
  device_name: string | null;
  created_at: string;
  last_seen_at: string;
}

const TABLE = "push_devices";

async function signedIn(client: SupabaseClient): Promise<boolean> {
  const { data } = await client.auth.getSession();
  return !!data.session?.user;
}

export async function listPushDevices(client: SupabaseClient = accountClient()): Promise<PushDevicesView> {
  if (!(await signedIn(client))) return { signedIn: false, devices: [] };
  const { data, error } = await client
    .from(TABLE)
    .select("id, platform, device_name, created_at, last_seen_at")
    .order("last_seen_at", { ascending: false });
  if (error) throw new Error(`Couldn't read your phones: ${error.message}`);
  const devices = ((data as Row[] | null) ?? []).map((r) => ({
    id: r.id,
    platform: r.platform,
    deviceName: r.device_name,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  }));
  return { signedIn: true, devices };
}

// Unpairs a phone: it stops getting pushes until the app registers again (at its next launch while signed in).
export async function removePushDevice(id: string, client: SupabaseClient = accountClient()): Promise<void> {
  if (!(await signedIn(client))) throw new Error("Sign in to Weft to remove a phone.");
  const { error } = await client.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(`Couldn't remove that phone: ${error.message}`);
}
