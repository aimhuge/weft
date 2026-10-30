// The weft.zip board's side of starting a card and of answering one (lib/cloud-commands.ts is the row, lib/cloud-inbox.ts the Mac that
// runs it): where a new card can run, and how the commands this board sent are tracked as Realtime moves them.
import { commandText, isOpenCommand, type CloudCommandRow } from "./cloud-commands";
import type { CloudCardRow } from "./cloud-sync-types";
import { folderName } from "./format";
import { headline } from "./new-thread";

// A place a card can start: a folder on one of your Macs that already syncs. Only folders you run cards in
// are offered: a teammate's Mac won't act on your request, and a folder with no synced card is one the Mac
// has no sync switch for.
export interface WebTarget {
  device: string;
  folder: string;
  label: string;
}

// Your folders, most recently active first. Two that share a name are told apart by their full path; the same
// folder on two of your Macs by "Mac 1", "Mac 2".
export function webTargets(rows: CloudCardRow[], userId: string): WebTarget[] {
  const latest = new Map<string, { device: string; folder: string; at: string }>();
  for (const row of rows) {
    if (row.owner_user !== userId || row.deleted || row.card.role === "copilot" || !row.folder) continue;
    const key = `${row.owner_device}\n${row.folder}`;
    const seen = latest.get(key);
    if (!seen || row.updated_at > seen.at) latest.set(key, { device: row.owner_device, folder: row.folder, at: row.updated_at });
  }
  const found = [...latest.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const count = (pick: (t: (typeof found)[number]) => string, value: string) => found.filter((t) => pick(t) === value).length;
  return found.map((t) => {
    const name = folderName(t.folder);
    if (count((x) => folderName(x.folder), name) === 1) return { device: t.device, folder: t.folder, label: name };
    if (count((x) => x.folder, t.folder) === 1) return { device: t.device, folder: t.folder, label: t.folder };
    const macs = found.filter((x) => x.folder === t.folder).map((x) => x.device);
    return { device: t.device, folder: t.folder, label: `${name} · Mac ${macs.indexOf(t.device) + 1}` };
  });
}

// What Realtime sends for cloud_commands.
export type CloudCommandChange =
  | { eventType: "INSERT" | "UPDATE"; new: CloudCommandRow; old: Partial<CloudCommandRow> | null }
  | { eventType: "DELETE"; old: Partial<CloudCommandRow> | null };

// The commands this board sent, kept current: a change replaces the command in place, a delete drops it.
export function applyCommandChange(commands: CloudCommandRow[], change: CloudCommandChange): CloudCommandRow[] {
  if (change.eventType === "DELETE") {
    const id = change.old?.id;
    return id ? commands.filter((c) => c.id !== id) : commands;
  }
  const at = commands.findIndex((c) => c.id === change.new.id);
  if (at === -1) return [...commands, change.new];
  return commands.map((c, i) => (i === at ? change.new : c));
}

// The strip under the header: what you asked for and how far it got.
export function commandLine(command: CloudCommandRow): { title: string; note: string } {
  const title = headline(commandText(command)) || "New thread";
  switch (command.status) {
    case "pending":
      return { title, note: "Waiting for your Mac to pick it up. It has to be on and running Weft." };
    case "claimed":
      return { title, note: "Starting on your Mac…" };
    case "failed":
      return { title, note: command.error ?? "Your Mac couldn't start it." };
    case "done":
      return { title, note: "Started." };
  }
}

// A reply, an answer to a waiting request or a Stop: a command for one card's thread rather than a new card.
export const isCardCommand = (c: Pick<CloudCommandRow, "kind">) => c.kind === "reply" || c.kind === "answer" || c.kind === "stop";

// A worker's sign-ins and clones come from Settings and the project menu on the desktop, and report back there.
const isWorkerAdmin = (c: Pick<CloudCommandRow, "kind">) => c.kind === "login" || c.kind === "github_login" || c.kind === "clone";

// The strip under the header follows new threads; a card's own commands show under its reply box instead.
export const boardCommands = (commands: CloudCommandRow[]) => commands.filter((c) => !isCardCommand(c) && !isWorkerAdmin(c));

// The commands sent to one card that haven't reached its thread yet, or that failed.
export function cardReplies(commands: CloudCommandRow[], cardId: string): CloudCommandRow[] {
  return commands.filter((c) => isCardCommand(c) && (c.payload as { cardId?: string }).cardId === cardId && (isOpenCommand(c) || c.status === "failed"));
}

// Whether the web can reply to a card: only the Mac of the account that runs it obeys (lib/cloud-inbox.ts).
export const canReply = (row: Pick<CloudCardRow, "owner_user" | "deleted">, userId: string) => row.owner_user === userId && !row.deleted;

// Under the reply box: how far a reply got.
export function replyNote(command: CloudCommandRow): string {
  switch (command.status) {
    case "pending":
      return "Waiting for your Mac. It has to be on and running Weft.";
    case "claimed":
      return "Sending on your Mac…";
    case "failed":
      return command.error ?? "Your Mac couldn't send it.";
    case "done":
      return "Sent.";
  }
}
