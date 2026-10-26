// The Mac's side of "start a card from the weft.zip board", "reply to a thread from it", "answer a thread's
// pending permission or question", and "stop a thread's running turn" (docs/architecture/cloud-sync.md). The
// web inserts a cloud_commands row addressed to this device; this hears it over Realtime (and a 30 s check,
// since a socket can drop while the Mac sleeps), claims it, and either makes the card in the folder it names
// and starts the thread, sends the reply as if it were typed here, answers the pending request, or stops the
// turn. Either way the result syncs back through the outbox like any other change, so the web board sees it
// appear.
//
// It only obeys a command that is (1) for this device, (2) created by the account signed in here, (3) for a
// folder switched on in Settings → Sync and (4) for the workspace this Mac syncs to. A Realtime event is just
// a nudge: what runs is always read back from the table, never taken from the event.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { answerBody, newCardBody, replyBody, stopBody, type CloudCommandRow } from "./cloud-commands";
import { syncNow, syncOrgId } from "./cloud-sync";
import { deviceId } from "./device-id";
import { globalSingleton } from "./global-singleton";
import { startFeatureCard } from "./card-starter";
import { answerPermission, sendUserMessage, stop } from "./runner";
import { syncFolders } from "./settings";
import { getCard } from "./store";

const CHECK_MS = 30_000;
const BATCH = 20;
const ERROR_MAX = 300;

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
    const uid = syncFolders().length ? await signedInUser(client) : null;
    if (!uid) {
      await stopListening(client);
      return;
    }
    if (g.channel && g.uid === uid) {
      await drain();
      return;
    }
    await stopListening(client);
    g.uid = uid;
    const device = deviceId();
    g.channel = client
      .channel(`cloud-commands-${device}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cloud_commands", filter: `target_device=eq.${device}` }, () => void drain())
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") void drain();
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
    const cardId = await startFromCommand(client, uid, command);
    await report(client, command.id, { status: "done", card_id: cardId });
  } catch (err) {
    await report(client, command.id, { status: "failed", error: (err as Error).message.slice(0, ERROR_MAX) });
  }
}

async function startFromCommand(client: SupabaseClient, uid: string, command: CloudCommandRow): Promise<string> {
  // A newer web board may send a kind this version doesn't know.
  const kind: string = command.kind;
  if (kind !== "new_card" && kind !== "reply" && kind !== "answer" && kind !== "stop") throw new Error("This version of Weft doesn't know that kind of request. Update the desktop app.");
  if (command.created_by !== uid) throw new Error("That request wasn't made by the account signed in on this Mac.");
  if (!syncFolders().includes(command.folder)) throw new Error(`${command.folder} isn't switched on in Settings → Sync on this Mac.`);
  const org = await syncOrgId(client, uid);
  if (org !== command.org_id) throw new Error("That workspace isn't the one this Mac syncs its cards to.");
  if (kind === "reply") return replyFromCommand(command);
  if (kind === "answer") return answerFromCommand(command);
  if (kind === "stop") return stopFromCommand(command);
  const card = await startFeatureCard(newCardBody(command));
  // The card and its first items are already in the outbox; send them now so the board sees it start.
  syncNow();
  return card.id;
}

// A reply goes to the card the way the reply box sends one: now, or after the turn that's running (the card shows it
// queued). Only to a card in the command's folder, so a reply can't reach a thread outside a synced folder.
function replyFromCommand(command: CloudCommandRow): string {
  const reply = replyBody(command);
  if (!reply) throw new Error("That reply is empty.");
  const card = getCard(reply.cardId);
  if (!card || card.cwd !== command.folder) throw new Error("That thread isn't on this Mac anymore.");
  if (card.role === "copilot") throw new Error("The copilot can't be answered from the web.");
  sendUserMessage(card.id, reply.text);
  // The message is in the outbox already; this sends it now rather than on the next tick.
  syncNow();
  return card.id;
}

// An answer goes to the card's pending permission request or question: it has to be in the command's folder
// (so a reply can't reach a thread outside a synced folder), and not the copilot. answerPermission throws when
// the request isn't waiting any more, which the run() above turns into a failed report.
function answerFromCommand(command: CloudCommandRow): string {
  const answer = answerBody(command);
  if (!answer) throw new Error("That answer is empty.");
  const card = getCard(answer.cardId);
  if (!card || card.cwd !== command.folder) throw new Error("That thread isn't on this Mac anymore.");
  if (card.role === "copilot") throw new Error("The copilot can't be answered from the web.");
  answerPermission(card.id, answer.allow, answer.answers, answer.pendingId, answer.reply);
  // Settling an answer already updates the card; sync so the web board sees the new state.
  syncNow();
  return card.id;
}

// A stop ends the card's running turn. Same card checks as the other card-bound kinds.
async function stopFromCommand(command: CloudCommandRow): Promise<string> {
  const body = stopBody(command);
  if (!body) throw new Error("That stop is missing the card.");
  const card = getCard(body.cardId);
  if (!card || card.cwd !== command.folder) throw new Error("That thread isn't on this Mac anymore.");
  if (card.role === "copilot") throw new Error("The copilot can't be stopped from the web.");
  await stop(card.id);
  // stop() ends the turn; sync so the web board sees the card back in needs_you / idle.
  syncNow();
  return card.id;
}

async function report(client: SupabaseClient, id: string, patch: { status: "done" | "failed"; card_id?: string; error?: string }) {
  const { error } = await client.from("cloud_commands").update(patch).eq("id", id);
  if (error) console.warn(`Cloud inbox: couldn't report on ${id}: ${error.message}`);
}
