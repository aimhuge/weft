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
import { newCardBody, type CloudCommandRow } from "./cloud-commands";
import { macReceive } from "./cloud-inbox-receive";
import { syncNow, syncOrgId } from "./cloud-sync";
import { deviceId } from "./device-id";
import { applyFolderGrant } from "./folder-grant";
import { cardKinds, dispatcher, type CardRules } from "./host/dispatch";
import { needsElevation, runVerb, type HostVerb } from "./host-api";
import { syncFolders } from "./settings";
import { getCard } from "./store";
import { pairingStatus } from "./sync-security";

// Why a verb that grants power can't run from the web: a phone is paired, and only it approves. The phone can't sign
// a host verb yet, so until it can, these stay on the Mac (or Settings → Sync lets the web approve).
export const ELEVATED_REFUSED = "That needs this Mac while a phone is paired: run it here. (Settings → Sync can let the web approve.)";

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

// A new card from the web: its pasted files brought over first, a mode that asks less than the default held to the
// same rule as a mode change (the phone's, while one is paired), and one asked for in Backlog made and left there.
async function newCard(command: CloudCommandRow, receive: (text: string, payload: unknown) => Promise<string>): Promise<string> {
  const body = newCardBody(command);
  const mode = body.permissionMode as string | undefined;
  const refused = mode && mode !== "default" && mode !== "plan" ? await macRules.elevated?.("card.update", { id: "", body: { permissionMode: mode } }) : null;
  if (refused) throw new Error(refused);
  if (typeof body.prompt === "string") body.prompt = await receive(body.prompt, command.payload);
  const card = body.start === false ? createCardFromBody(body) : await startFeatureCard(body);
  // The card and its first items are already in the outbox; send them now so the board sees it start.
  syncNow();
  return card.id;
}

// Every kind runs only for a command made by the account signed in here, in a folder switched on in Settings → Sync,
// for the workspace this Mac syncs to. A new card may name its folder by project name (a run sent to this Mac as a
// worker); the rest name the path.
function macCheck(client: SupabaseClient, uid: string) {
  return async (command: CloudCommandRow): Promise<CloudCommandRow> => {
    if (command.created_by !== uid) throw new Error("That request wasn't made by the account signed in on this Mac.");
    const folder = command.kind === "new_card" ? syncFolderFor(command.folder) : syncFolders().includes(command.folder) ? command.folder : null;
    if (!folder) throw new Error(`${command.folder} isn't switched on in Settings → Sync on this Mac.`);
    const org = await syncOrgId(client, uid);
    if (org !== command.org_id) throw new Error("That workspace isn't the one this Mac syncs its cards to.");
    return { ...command, folder };
  };
}

// The Mac's dispatch for one signed-in account. A file pasted on weft.zip comes down through the account's session.
export function macDispatch(client: SupabaseClient, uid: string) {
  const receive = macReceive(client, uid);
  return dispatcher({ new_card: (command) => newCard(command, receive), ...cardKinds({ ...macRules, receive }) }, UNKNOWN_KIND, macCheck(client, uid));
}
