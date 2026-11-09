// The Mac's side of "start a card from the weft.zip board", "reply to a thread from it", "answer a thread's
// pending permission or question", and "stop a thread's running turn" (docs/architecture/cloud-sync.md). The
// web inserts a cloud_commands row addressed to this device; this hears it over Realtime (and a 30 s check,
// since a socket can drop while the Mac sleeps), claims it, and either makes the card in the folder it names
// and starts the thread, sends the reply as if it were typed here, answers the pending request, or stops the
// turn, or runs any other verb of lib/host-api (a `host` command, whose result goes back on the row). The card
// kinds are host verbs underneath (lib/cloud-inbox-cards.ts). Either way the result syncs back through the outbox
// like any other change, so the web board sees it appear.
//
// The loop itself is the host core's (lib/host/inbox.ts), shared with the Weft Worker daemon: this file is the Mac's
// identity (the account's session: a conditional-update claim and the update-own grant, lib/host/identity.ts), its
// wake-up (postgres_changes, since it has a session), its beat (lib/host/beat.ts, ticked on each check) and its kinds.
//
// It only obeys a command that is (1) for this device, (2) created by the account signed in here, (3) for a
// folder switched on in Settings → Sync and (4) for the workspace this Mac syncs to. A Realtime event is just
// a nudge: what runs is always read back from the table, never taken from the event.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { macDispatch } from "./cloud-inbox-cards";
import { beatDesktopWorker, desktopStatus } from "./desktop-worker";
import { drainDeviceCalls } from "./device-calls";
import { deviceId } from "./device-id";
import { globalSingleton } from "./global-singleton";
import { createBeat } from "./host/beat";
import { sessionLine } from "./host/identity";
import { createInbox, newInboxState, startPolling, type Connection } from "./host/inbox";
import { syncedFolders } from "./cloud-sync-team";
import { hasQaGrant } from "./qa-grants";

export { syncFolderFor } from "./cloud-inbox-cards";

const CHECK_MS = 30_000;
const warn = (msg: string) => console.warn(`Cloud inbox: ${msg}`);

function safeClient(): SupabaseClient | null {
  try {
    return accountClient();
  } catch {
    return null; // accounts aren't set up in this build
  }
}

async function signedInUser(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

// Who this Mac acts as for one pass, read afresh each time: the account signed in now, or nobody.
async function connect(): Promise<Connection | null> {
  const client = safeClient();
  const uid = client ? await signedInUser(client) : null;
  if (!client || !uid) return null;
  return { line: sessionLine(client, uid, deviceId(), warn), dispatch: macDispatch(client, uid) };
}

// Listening means this Mac takes the web board's commands, and says so in the workspace's Workers list. One beat per
// check, as the account the check found: no presence, so every tick writes the row, and never an offline on the way out.
const beat = (client: SupabaseClient, uid: string) =>
  createBeat({
    heartbeat: (status) => beatDesktopWorker(client, uid, status),
    status: desktopStatus,
    // Keeps the leases of the commands this Mac is running (lib/host/lease.ts).
    renew: () => inbox().renew(sessionLine(client, uid, deviceId(), warn)),
    after: () => {},
    log: console.warn,
    label: "Desktop worker",
  }).tick();

// Only state lives across a module reload; the inbox and its closures are built from this module each time, so a
// reloaded server never runs a stale handler. The single-flight flags carry over, so two drains still can't overlap.
const live = () =>
  globalSingleton("__weftCloudInbox", () => ({
    started: false,
    channel: null as RealtimeChannel | null,
    uid: null as string | null,
    stopChecks: null as (() => void) | null,
    flight: newInboxState(),
  }));

// Reads this device's pending commands from the account's own table and runs them oldest first.
const inbox = () => createInbox({ connect, log: warn, state: live().flight });
const drain = () => inbox().poll();

async function stopListening(client: SupabaseClient | null) {
  const g = live();
  const channel = g.channel;
  g.channel = null;
  g.uid = null;
  if (channel && client) await client.removeChannel(channel);
}

// Listens while you're signed in and a folder syncs; otherwise holds nothing open. Called on start, on every
// sign-in or sign-out, and by the 30 s check (which is how a folder switched on later gets picked up).
export async function refreshCloudInbox() {
  const g = live();
  const client = safeClient();
  if (!client) return;
  try {
    // Local Simulator needs the Mac listening, and showing as present, even with no folder synced.
    const uid = syncedFolders().length || hasQaGrant() ? await signedInUser(client) : null;
    if (!uid) {
      await stopListening(client);
      return;
    }
    void beat(client, uid);
    if (g.channel && g.uid === uid) {
      await Promise.all([drain(), drainDeviceCalls(client, uid)]);
      return;
    }
    await stopListening(client);
    g.uid = uid;
    const device = deviceId();
    g.channel = client
      .channel(`cloud-commands-${device}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cloud_commands", filter: `target_device=eq.${device}` }, () => void drain())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "device_calls", filter: `target_device=eq.${device}` }, () => void drainDeviceCalls(client, uid))
      .subscribe((status: string) => {
        if (status !== "SUBSCRIBED") return;
        void drain();
        void drainDeviceCalls(client, uid);
      });
  } catch (err) {
    warn((err as Error).message);
  }
}

// Once per server process (from startAccountCloudSync): follows sign-in and sign-out, then checks on a timer.
export function startCloudInbox(): () => void {
  const g = live();
  if (g.started) return () => {};
  g.started = true;
  let unsubscribe = () => {};
  try {
    // supabase-js warns against awaiting its calls inside this callback, so the refresh runs after it.
    const { data } = accountClient().auth.onAuthStateChange(() => void setTimeout(() => void refreshCloudInbox(), 0));
    unsubscribe = () => data.subscription.unsubscribe();
  } catch {
    // Accounts aren't set up in this build: nothing to hear.
  }
  // The poll backstop: a socket can drop while the Mac sleeps. Each check also follows sign-in and Settings → Sync.
  g.stopChecks = startPolling(() => void refreshCloudInbox(), { fastMs: CHECK_MS });
  void refreshCloudInbox();
  return () => {
    unsubscribe();
    g.stopChecks?.();
    g.stopChecks = null;
    g.started = false;
    void stopListening(safeClient());
  };
}
