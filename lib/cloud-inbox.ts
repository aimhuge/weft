// The Mac's side of "start a card from the weft.zip board", "reply to a thread from it", "answer a thread's
// pending permission or question", and "stop a thread's running turn" (docs/architecture/cloud-sync.md). The
// web inserts a cloud_commands row addressed to this device; this hears it over Realtime (and a 30 s check,
// since a socket can drop while the Mac sleeps), claims it, and either makes the card in the folder it names
// and starts the thread, sends the reply as if it were typed here, answers the pending request, or stops the
// turn, or runs any other verb of lib/host-api (a `host` command, whose result goes back on the row). The card
// kinds are host verbs underneath (lib/cloud-inbox-cards.ts). Either way the result syncs back through the outbox
// like any other change, so the web board sees it appear.
//
// It only obeys a command that is (1) for this device, (2) created by the account signed in here, (3) for a
// folder switched on in Settings → Sync and (4) for the workspace this Mac syncs to. A Realtime event is just
// a nudge: what runs is always read back from the table, never taken from the event.
import path from "node:path";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { newCardBody, type CloudCommandRow } from "./cloud-commands";
import { answerFromCommand, hostFromCommand, replyFromCommand, stopFromCommand } from "./cloud-inbox-cards";
import { syncNow, syncOrgId } from "./cloud-sync";
import { beatDesktopWorker } from "./desktop-worker";
import { drainDeviceCalls } from "./device-calls";
import { deviceId } from "./device-id";
import { globalSingleton } from "./global-singleton";
import { startFeatureCard } from "./card-starter";
import { hostFailure, isHostDone, type HostDone, type HostResult } from "./host-command";
import { syncFolders } from "./settings";
import { hasQaGrant } from "./qa-grants";

const CHECK_MS = 30_000;
const BATCH = 20;
const ERROR_MAX = 300;
// The kinds a Mac runs; reply, answer and stop are host verbs underneath (lib/cloud-inbox-cards.ts).
const MAC_KINDS = new Set(["new_card", "reply", "answer", "stop", "host"]);

const live = () =>
  globalSingleton("__weftCloudInbox", () => ({
    started: false,
    channel: null as RealtimeChannel | null,
    uid: null as string | null,
    timer: null as ReturnType<typeof setInterval> | null,
    draining: false,
    again: false,
  }));

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
    const uid = syncFolders().length || hasQaGrant() ? await signedInUser(client) : null;
    if (!uid) {
      await stopListening(client);
      return;
    }
    // Listening means this Mac takes the web board's commands: say so in the workspace's Workers list.
    void beatDesktopWorker(client, uid);
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
    console.warn(`Cloud inbox: ${(err as Error).message}`);
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
  g.timer = setInterval(() => void refreshCloudInbox(), CHECK_MS);
  void refreshCloudInbox();
  return () => {
    unsubscribe();
    if (g.timer) clearInterval(g.timer);
    g.timer = null;
    g.started = false;
    void stopListening(safeClient());
  };
}

// Reads this device's pending commands from the account's own table and runs them oldest first. One drain at a
// time; a nudge that arrives mid-drain makes it look again when it ends.
async function drain() {
  const g = live();
  if (g.draining) {
    g.again = true;
    return;
  }
  g.draining = true;
  // Read through a function: TypeScript would take `g.again` as the false it was just set to.
  const nudged = () => g.again;
  try {
    do {
      g.again = false;
      const client = safeClient();
      const uid = client ? await signedInUser(client) : null;
      if (!client || !uid) return;
      const { data, error } = await client
        .from("cloud_commands")
        .select("*")
        .eq("target_device", deviceId())
        .eq("created_by", uid)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(BATCH)
        .overrideTypes<CloudCommandRow[]>();
      if (error) throw new Error(error.message);
      for (const command of data) await run(client, uid, command);
    } while (nudged());
  } catch (err) {
    console.warn(`Cloud inbox: ${(err as Error).message}`);
  } finally {
    g.draining = false;
  }
}

// Claims a command (the update only matches while it is still pending, so a command can't run twice), runs it
// and says how it went. A claimed command is never retried: a card that was made must not be made again.
async function run(client: SupabaseClient, uid: string, command: CloudCommandRow) {
  const claim = await client.from("cloud_commands").update({ status: "claimed" }).eq("id", command.id).eq("status", "pending").select("id");
  if (claim.error || !claim.data.length) return;
  try {
    const done = await startFromCommand(client, uid, command);
    await report(client, command.id, isHostDone(done) ? { status: "done", card_id: done.cardId, result: done.result } : { status: "done", card_id: done });
  } catch (err) {
    const error = (err as Error).message.slice(0, ERROR_MAX);
    // A host command's result says it failed too; the other kinds leave the column alone.
    await report(client, command.id, command.kind === "host" ? { status: "failed", error, result: hostFailure(error) } : { status: "failed", error });
  }
}

async function startFromCommand(client: SupabaseClient, uid: string, command: CloudCommandRow): Promise<string | HostDone> {
  // A newer web board may send a kind this version doesn't know.
  const kind: string = command.kind;
  if (!MAC_KINDS.has(kind)) throw new Error("This version of Weft doesn't know that kind of request. Update the desktop app.");
  if (command.created_by !== uid) throw new Error("That request wasn't made by the account signed in on this Mac.");
  // A new card may name its folder by project name (a run sent to this Mac as a worker); the rest name the path.
  const folder = kind === "new_card" ? syncFolderFor(command.folder) : syncFolders().includes(command.folder) ? command.folder : null;
  if (!folder) throw new Error(`${command.folder} isn't switched on in Settings → Sync on this Mac.`);
  const org = await syncOrgId(client, uid);
  if (org !== command.org_id) throw new Error("That workspace isn't the one this Mac syncs its cards to.");
  if (kind === "reply") return replyFromCommand(command);
  if (kind === "answer") return answerFromCommand(command);
  if (kind === "stop") return stopFromCommand(command);
  if (kind === "host") return hostFromCommand(command);
  const card = await startFeatureCard(newCardBody({ ...command, folder }));
  // The card and its first items are already in the outbox; send them now so the board sees it start.
  syncNow();
  return card.id;
}

// The synced folder a new card names: its path, or a project name that matches exactly one synced folder's name.
export function syncFolderFor(name: string): string | null {
  const folders = syncFolders();
  if (folders.includes(name)) return name;
  const named = folders.filter((f) => path.basename(f) === name);
  return named.length === 1 ? (named[0] ?? null) : null;
}

async function report(client: SupabaseClient, id: string, patch: { status: "done" | "failed"; card_id?: string; error?: string; result?: HostResult }) {
  const { error } = await client.from("cloud_commands").update(patch).eq("id", id);
  if (error) console.warn(`Cloud inbox: couldn't report on ${id}: ${error.message}`);
}
