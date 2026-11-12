// The Mac's kind table (lib/cloud-inbox.ts claims and reports what it runs): new_card, and the card kinds reply,
// answer, stop and host, which are lib/host-api's verbs underneath, run through the shared table in
// lib/host/dispatch.ts with the same runVerb as the desktop's own routes. What the Mac adds is its CardRules: the card
// must be in the command's synced folder and not the copilot, an answer passes the approval rule
// (lib/approval-check.ts), and so does every other verb that grants power. The change syncs at once after each.
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approvalProblem } from "./approval-check";
import { shell } from "./browser-shell";
import { startFeatureCard } from "./card-starter";
import { createCardFromBody } from "./new-card";
import { newCardBody, type CloudCommandRow, type NewCardMode } from "./cloud-commands";
import { signedAgent, type WidenCheck } from "./create-widen";
import { networkStartMode } from "./cloud-new-card-mode";
import { macReceive } from "./cloud-inbox-receive";
import { macSnapshotVerb } from "./mac-snapshot";
import { syncNow, syncOrgId } from "./cloud-sync";
import { orgForFolder } from "./cloud-sync-route";
import { deviceId } from "./device-id";
import { applyFolderGrant } from "./folder-grant";
import { cardKinds, dispatcher, NO_HOST_VERBS, type CardRules } from "./host/dispatch";
import { needsElevation, runVerb, type HostVerb } from "./host-api";
import { defaultPermissionMode, syncFolders } from "./settings";
import { getCard } from "./store";
import { holdWorkerCard, sentByWorker } from "./worker-origin";
import { pairingStatus } from "./sync-security";
import type { WidenChange } from "./widen";
import { widenProblem, type Verified } from "./widen-check";
import type { NonceBook } from "./widen-nonces";

// Why a verb that grants power can't run from the web: a phone is paired, and only it approves. The phone can't sign
// a host verb yet, so until it can, these stay on the Mac (or Settings → Sync lets the web approve).
export const ELEVATED_REFUSED = "That needs this Mac while a phone is paired: run it here. (Settings → Sync can let the web approve.)";

// The widening approvals this Mac has run: Electron main spends each nonce (electron/widen-nonces.cjs), never a file this
// server reads back, which a thread running as the same user could rewrite to replay an approval. Main is asked only
// once the signature checked out, so `has` leaves it all to `take`.
export const macNonces: NonceBook = {
  has: () => false,
  take: async (nonce, _until, issuedAt) => (await shell("/pairing/widen-nonce", { nonce, issuedAt })).ok === true,
};

// A card the web moves goes only to a folder switched on in Settings → Sync: one the web sees, never "/" or ~.
export function macConfine(change: WidenChange): string | null {
  return change.cwd === undefined || syncFolders().includes(change.cwd) ? null : `${change.cwd} isn't switched on in Settings → Sync on this Mac.`;
}

// This Mac's own desktop key signs for remote hosts; a command from the network that names it here would be the board
// acting on itself, which it does through its own routes, never the relay.
export const OWN_KEY = "This Mac's own approval key widens its cards from its own window, not from the network.";

const macWiden: WidenCheck = async (target, auth, refusal) =>
  widenProblem(target, auth, refusal, {
    host: deviceId(),
    now: Date.now(),
    nonces: macNonces,
    verify: async (body) => (body.device === deviceId() ? { ok: false, reason: OWN_KEY } : ((await shell("/pairing/verify", body)) as Verified)),
    passkey: async (body) => (await shell("/pairing/passkey-verify", body)) as Verified,
    confine: macConfine,
    // A passkey signs a "!" line only where Settings → Sync lets the web approve: there, a passkey is a shell.
    passkeyShell: (await pairingStatus()).webApprovals,
  });

const UNKNOWN_KIND = "This version of Weft doesn't know that kind of request. Update the desktop app.";

const macRules: CardRules = {
  // In the command's folder (so a command can't reach a thread outside a synced folder), and not the copilot. A stop
  // that names no card never gets here (emptyStop).
  card(cardId, command, use) {
    const card = getCard(cardId as string);
    if (!card || card.cwd !== command.folder) throw new Error("That thread isn't on this Mac anymore.");
    if (card.role === "copilot") throw new Error(`The copilot can't be ${use} from the web.`);
    return card;
  },
  verb: (verb, args) => runVerb(verb, args as never),
  grant: applyFolderGrant,
  // A signed answer must be a paired phone's (or a paired browser's passkey), and an unsigned Allow on a permission
  // request waits for the phone once one is paired.
  async approve(command, answer, card) {
    const pairing = await pairingStatus();
    return approvalProblem(command, answer, card.pending, {
      verify: async (body) => (await shell("/pairing/verify", body)) as { ok: boolean; reason?: string },
      approvers: () => Promise.resolve(pairing.approvers),
      webApprovals: pairing.webApprovals,
      now: Date.now(),
      // A browser's passkey: the message is rebuilt from this Mac's own device id and workspace (the inbox has already
      // refused a command whose org isn't the one this Mac syncs to), and main checks it against the pin.
      passkey: {
        self: { orgId: command.org_id, macDevice: deviceId(), folder: card.cwd },
        verify: async (body) => (await shell("/pairing/passkey-verify", body)) as { ok: boolean; reason?: string },
      },
    });
  },
  // Any other verb that grants power (the shell, Wait, This first, a mode or a read grant) goes through only while the
  // web may approve: no phone paired, or Settings → Sync says so.
  async elevated(verb: HostVerb, args) {
    if (!needsElevation(verb, args as never)) return null;
    const pairing = await pairingStatus();
    return pairing.approvers > 0 && !pairing.webApprovals ? ELEVATED_REFUSED : null;
  },
  // A signed widening: a paired phone's or this Mac's own key, or a paired browser's passkey, checked by main against
  // its pins over the message rebuilt from this Mac's own id (lib/widen-check.ts).
  widen: (target, auth, refusal) => macWiden(target, auth, refusal),
  // The one host-level verb a Mac takes from the network: a paired Mac's signed ask for this Mac's uncommitted work
  // (lib/mac-snapshot.ts checks the approval against the Macs pinned here). Every other one stays NO_HOST_VERBS.
  hostVerb: (verb, args) => {
    if (verb !== "tree.snapshot") throw new Error(NO_HOST_VERBS);
    return macSnapshotVerb(args);
  },
  // The change is in the outbox already; this sends it now rather than on the next tick.
  after: () => syncNow(),
  answerAsKind: true,
  questionReplies: true,
  emptyStop: "That stop is missing the card.",
};

// The synced folder a new card names: its path, or a project name that matches exactly one synced folder's name.
export function syncFolderFor(name: string): string | null {
  const folders = syncFolders();
  if (folders.includes(name)) return name;
  const named = folders.filter((f) => path.basename(f) === name);
  return named.length === 1 ? (named[0] ?? null) : null;
}

// A new card from the web: its pasted files brought over first, its mode (named, or this Mac's default) held to the same
// rule as a mode change (lib/cloud-new-card-mode.ts), and one asked for in Backlog made and left there.
async function newCard(command: CloudCommandRow, receive: (text: string, payload: unknown, orgId?: string) => Promise<string>): Promise<string> {
  // A card a Weft Worker sent never starts itself here: Backlog, `default`, for the user to start (lib/worker-origin.ts).
  if (sentByWorker(command.payload)) return made(createCardFromBody(holdWorkerCard(newCardBody(command))));
  const body = newCardBody(command);
  // An agent only with a signed approval for it, over the synced folder the check resolved (lib/create-widen.ts).
  const agent = await signedAgent(command, command.folder, macWiden);
  if (agent) body.agent = agent;
  body.permissionMode = await networkStartMode(body.permissionMode as NewCardMode | undefined, {
    defaultMode: defaultPermissionMode,
    refusal: async (permissionMode) => (await macRules.elevated?.("card.update", { id: "", body: { permissionMode } })) ?? null,
  });
  if (typeof body.prompt === "string") body.prompt = await receive(body.prompt, command.payload, command.org_id);
  return made(body.start === false ? createCardFromBody(body) : await startFeatureCard(body));
}

// The card and its first items are already in the outbox; send them now so the board sees it.
function made(card: { id: string }): string {
  syncNow();
  return card.id;
}

// Another Mac's ask for this one's uncommitted work names its project by name: it can't know the path here.
const asksForWork = (command: CloudCommandRow) => command.kind === "host" && (command.payload as { verb?: unknown } | null)?.verb === "tree.snapshot";

// Every kind runs only for a command made by the account signed in here, in a folder switched on in Settings → Sync,
// for the workspace this Mac syncs that folder to. A new card may name its folder by project name (a run sent to this Mac as a
// worker); the rest name the path.
function macCheck(client: SupabaseClient, uid: string) {
  return async (command: CloudCommandRow): Promise<CloudCommandRow> => {
    if (command.created_by !== uid) throw new Error("That request wasn't made by the account signed in on this Mac.");
    const byName = command.kind === "new_card" || asksForWork(command);
    const folder = byName ? syncFolderFor(command.folder) : syncFolders().includes(command.folder) ? command.folder : null;
    if (!folder) throw new Error(`${command.folder} isn't switched on in Settings → Sync on this Mac.`);
    // Its workspace is the one this folder's cards sync to: a team that linked its project, or home.
    const home = await syncOrgId(client, uid);
    const org = home ? await orgForFolder(client, home, folder) : null;
    if (org !== command.org_id) throw new Error("That workspace isn't the one this Mac syncs this project's cards to.");
    return { ...command, folder };
  };
}

// The Mac's dispatch for one signed-in account. A file pasted on weft.zip comes down through the account's session.
export function macDispatch(client: SupabaseClient, uid: string) {
  const receive = macReceive(client, uid);
  return dispatcher({ new_card: (command) => newCard(command, receive), ...cardKinds({ ...macRules, receive, fromOwner: (command) => command.created_by === uid }) }, UNKNOWN_KIND, macCheck(client, uid));
}
