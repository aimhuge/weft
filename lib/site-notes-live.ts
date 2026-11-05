import path from "node:path";
import { accountClient } from "./account";
import { complete } from "./haiku";
import { captureAfterTurn } from "./site-notes-capture";
import { notesForUrl } from "./site-notes-read";
import { remoteNotes, reportRemote, uploadRemote, type RemoteDeps } from "./site-notes-remote";
import { markLocalOutcome, publicSharingOn, queueOutbox, readHostNotes, readNote, writeNote } from "./site-notes-store";
import { getCard } from "./store";

// Site notes wired to the real Mac: the account's token, Haiku, ~/.weft/site-notes and weft.zip. The tools
// (lib/browser-tools.ts) and the after-turn hook (lib/show.ts) call these two; the logic is in the modules
// they import, each tested on its own.

async function token(): Promise<string | null> {
  const { data } = await accountClient().auth.getSession();
  return data.session?.access_token ?? null;
}

export const remoteDeps: RemoteDeps = { token, fetchFn: (...args) => fetch(...args), env: process.env };

// What names this user, scrubbed out of every note: their account's email, name and login, and the card's folder.
export async function knownValues(cardId: string): Promise<string[]> {
  const { data } = await accountClient().auth.getSession();
  const user = data.session?.user;
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const fromMeta = ["full_name", "name", "user_name", "preferred_username"].map((k) => meta[k]).filter((v): v is string => typeof v === "string");
  const email = user?.email ? [user.email, String(user.email.split("@")[0])] : [];
  const cwd = getCard(cardId)?.cwd;
  return [...email, ...fromMeta, ...(cwd ? [path.basename(cwd)] : [])];
}

export function siteNotesForUrl(cardId: string | undefined, url: string): Promise<string> {
  return notesForUrl(cardId, url, {
    local: (host) => readHostNotes(host),
    remote: (host) => remoteNotes(host, publicSharingOn(), remoteDeps),
  }).catch(() => "");
}

export function siteNotesAfterTurn(cardId: string, ask: string): Promise<void> {
  return captureAfterTurn(cardId, ask, {
    complete,
    known: () => knownValues(cardId),
    readLocal: (host, notePath) => readNote(host, notePath),
    writeLocal: (note) => void writeNote(note),
    markLocal: (host, notePath, outcome) => markLocalOutcome(host, notePath, outcome),
    upload: (u) => uploadRemote(u, remoteDeps),
    report: (r) => reportRemote(r, remoteDeps),
    publicOn: () => publicSharingOn(),
    queueOutbox: (item) => queueOutbox(item),
  }).catch(() => undefined);
}
