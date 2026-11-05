// The pure half of taking over a teammate's card (lib/team-takeover.ts): their thread made fit for a card on this Mac,
// and the brief its first session starts from. Their session, their files and their pictures stayed on their Mac, so
// what comes along is the transcript, and the brief says what didn't.
import { SEALED_TEXT } from "./sync-seal";
import type { TouchedFile } from "./handoff";
import type { Card, ThreadItem } from "./types";

// The most of their thread a takeover brings along, newest kept.
export const TAKEOVER_ITEMS_MAX = 400;

// A picture in Markdown pointing at a blob in their workspace, and any other blob ref: neither opens on this Mac.
const BLOB_IMAGE = /!\[([^\]]*)\]\(blob:sha256:[0-9a-f]+\)/g;
const BLOB_REF = /blob:sha256:[0-9a-f]+/g;

export const awayText = (text: string, name: string) =>
  text.replace(BLOB_IMAGE, (_, alt: string) => `(${alt ? `${alt}: ` : ""}a picture on ${name}'s Mac)`).replace(BLOB_REF, `(a file on ${name}'s Mac)`);

// One of their items as this Mac's thread can draw it, or null when it has no place here: a permission they were
// asked, or a row this Mac couldn't unseal. A cut tool result says where its output stayed.
export function importedItem(item: ThreadItem, name: string): ThreadItem | null {
  switch (item.kind) {
    case "permission":
      return null;
    case "user":
      return { kind: "user", text: awayText(item.text, name), at: item.at };
    case "assistant":
      return item.text === SEALED_TEXT ? null : { ...item, text: awayText(item.text, name) };
    case "tool": {
      const rest = { ...item, summary: awayText(item.summary, name) };
      delete rest.images;
      delete rest.resultBytes;
      const cut = item.resultBytes !== undefined && item.result === undefined;
      return cut ? { ...rest, result: `(The full output stayed on ${name}'s Mac.)` } : rest;
    }
    default:
      return item;
  }
}

export function importedItems(items: ThreadItem[], name: string): ThreadItem[] {
  return items.slice(-TAKEOVER_ITEMS_MAX).flatMap((item) => importedItem(item, name) ?? []);
}

// What the new card's thread says you asked: short, since the brief carries the detail.
export function takeoverMessage(card: Pick<Card, "title" | "remaining">, name: string, handed?: Handed): string {
  const open = card.remaining && card.remaining !== "none" ? ` Still open: ${card.remaining}.` : "";
  const from = handed ? `, which they handed over on \`${handed.branch}\`,` : "";
  return `Take over ${name}'s card "${card.title}"${from} and carry on from where it stands.${open}`;
}

// Their paths are on their Mac; under their checkout they read as the repo's own.
const repoPath = (file: string, root: string) => (root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file);

// The text ahead of that message in the first turn: whose card it was, a summary of its thread, what was left, the
// files it changed there, and where their changes are (only what they pushed reached this checkout).
// Where their work is when they handed it over (lib/handover.ts): the branch their Mac pushed, and its commit.
export interface Handed {
  branch: string;
  sha?: string;
}

// What the brief says about their code: on the branch they pushed for you, or only what they had pushed already.
function whereTheirWorkIs(name: string, handed?: Handed): string {
  if (handed) {
    const at = handed.sha ? ` at \`${handed.sha.slice(0, 12)}\`` : "";
    return `${name} handed this over: their Mac pushed the card's work, uncommitted edits included, to the branch \`${handed.branch}\`${at}. Start with \`git fetch origin ${handed.branch}\` and bring it into this checkout (merge it, or check it out on a branch of its own), then carry on from there.`;
  }
  return `Their uncommitted edits did not come along: only what they pushed is reachable. Before redoing anything, \`git fetch\` and look for their branch or commits, and compare with the files above. If their work isn't pushed, say so and ask whether to wait for ${name} or redo it.`;
}

export function takeoverBrief(card: Pick<Card, "title" | "remaining" | "cwd">, name: string, repo: string, summary: string, files: TouchedFile[], handed?: Handed): string {
  const lines = [
    "<system-reminder>",
    `This card continues ${name}'s card "${card.title}", which ran on their Mac. It runs here now, in this Mac's checkout of ${repo}, as a new session. Their thread is above as history; what came before, in short:`,
    "",
    summary.trim(),
  ];
  if (card.remaining && card.remaining !== "none") lines.push("", `Still open, from its last status line: ${card.remaining}`);
  if (files.length) lines.push("", `Files it changed on ${name}'s Mac:`, ...files.map((f) => `- ${repoPath(f.file, card.cwd)}`));
  lines.push(
    "",
    whereTheirWorkIs(name, handed),
    "</system-reminder>",
    "",
    "",
  );
  return lines.join("\n");
}
