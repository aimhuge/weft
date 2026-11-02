// The one way into the sealed attachments folder: a file the user pasted into this card's own thread.
// The secret guard seals the data dir, so a thread couldn't Read the screenshot its user had just pasted
// (2026-10-31). Only the exact file a user message on this card names opens, never the folder (a listing
// would show every other card's uploads) and never another card's attachment.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ATTACHMENT_NAME, MEDIA_REF, attachmentName } from "./media";
import { DATA_DIR, getThread } from "./store";
import type { ThreadItem } from "./types-thread";

// The attachment's file name, when file sits straight in the data dir's attachments folder (or a
// `.weft/attachments` folder: a Worker's thread can name the desktop's path).
function attachmentIn(file: string, dataDir: string): string | null {
  const resolved = path.resolve(file.replace(/^["']|["']$/g, "").replace(/^~(?=\/)/, os.homedir()));
  const name = path.basename(resolved);
  if (!ATTACHMENT_NAME.test(name)) return null;
  const dir = path.dirname(resolved);
  const inAttachments = dir === path.join(path.resolve(dataDir), "attachments") || /\/\.weft\/attachments$/i.test(dir);
  return inAttachments && !linkedAway(resolved) ? name : null;
}

// A link, or a file in a linked folder, could point into the vault under a pasted name: only a plain file
// whose real folder is still an attachments folder opens. A file that isn't there opens nothing to read.
function linkedAway(file: string): boolean {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return true;
    return path.basename(path.dirname(fs.realpathSync(file))) !== "attachments";
  } catch {
    return false;
  }
}

// The attachment names the user's messages on a card point at, folded and edited ones included.
function pastedNames(items: ThreadItem[]): Set<string> {
  const names = new Set<string>();
  for (const item of items) {
    if (item.kind === "edited") pastedNames(item.items).forEach((n) => names.add(n));
    if (item.kind !== "user") continue;
    for (const m of item.text.matchAll(MEDIA_REF)) {
      const name = attachmentName((m[2] ?? m[3]) as string);
      if (name) names.add(name);
    }
  }
  return names;
}

// Whether file is an attachment the user pasted into the card's thread.
export function pastedInto(cardId: string | undefined, file: string, dataDir = DATA_DIR, thread = getThread): boolean {
  if (!cardId || !file) return false;
  const name = attachmentIn(file, dataDir);
  return name !== null && pastedNames(thread(cardId)).has(name);
}

// Why a Read of an attachment path that isn't on this machine fails, or null for any other path. A file pasted on
// your Mac into a card that runs elsewhere (a Weft Worker) used to arrive as the Mac's path, and the guard turned it
// away as a secret: the real reason is that the file stayed where it was pasted (lib/attachment-transfer.ts).
export function pastedElsewhere(file: string): string | null {
  if (!file) return null;
  const resolved = path.resolve(file.replace(/^["']|["']$/g, "").replace(/^~(?=\/)/, os.homedir()));
  const name = path.basename(resolved);
  if (!ATTACHMENT_NAME.test(name) || path.basename(path.dirname(resolved)) !== "attachments" || fs.existsSync(resolved)) return null;
  return (
    `${name} was pasted on another machine and didn't reach this one, so there's nothing at that path to read. ` +
    "Ask the user to paste it again in this card's thread, or to describe what it shows."
  );
}
