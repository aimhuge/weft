// The one line under the full-page pane's page (docs/architecture/simple-mode.md, piece 1): a status dot and what
// the open card's thread is doing now. The dot is the show rail's own for the newest turn (showMinis), so the line
// and the rail never disagree; the text is the newest step while a turn runs, else the last sentence it wrote.
import { clip, plain, shortToolName, showMinis, type Dot, type Mini } from "@weft/client";
import type { ThreadItem } from "./types";

export type LiveDot = Exclude<Dot, "page">;
export type LiveLine = { dot: LiveDot; text: string };

const MAX_TEXT = 120;
const MAX_STEP = 60;

type Tool = Extract<ThreadItem, { kind: "tool" }>;

// A tool call as a step: "Edit · lib/foo.ts", "Bash · pnpm test", or just the tool's name.
export function stepLine(tool: Tool) {
  const name = shortToolName(tool.name);
  const what = tool.summary.trim();
  return what ? `${name} · ${clip(what, MAX_STEP)}` : name;
}

// The last sentence of a reply, in plain words.
export function lastSentence(text: string) {
  const words = plain(text);
  const sentences = words.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.at(-1) ?? "";
}

// The items of the newest turn: everything after your last message or "!" command.
function newestTurn(items: readonly ThreadItem[]) {
  const from = items.findLastIndex((i) => i.kind === "user" || i.kind === "shell");
  return items.slice(from + 1).filter((i) => i.kind !== "edited");
}

function turnText(items: readonly ThreadItem[], live: boolean) {
  // A paged thread can have holes before the loaded page; findLast would visit them as undefined, forEach skips them.
  const turn = newestTurn(items.filter(Boolean));
  const last = turn.at(-1);
  if (live && last?.kind === "tool") return stepLine(last);
  const reply = turn.findLast((i) => i.kind === "assistant" && lastSentence(i.text));
  if (reply?.kind === "assistant") return lastSentence(reply.text);
  return live ? "Working…" : undefined;
}

// live: the card's turn is running or waiting on you (lib/format.ts isLive). Null for an empty thread.
export function paneLiveLine(items: readonly ThreadItem[], { live = false, now = Date.now() } = {}): LiveLine | null {
  const newest = showMinis(items, { live, now }).findLast((m): m is Mini & { dot: LiveDot } => m.dot !== "page");
  if (!newest) return null;
  return { dot: newest.dot, text: clip(turnText(items, live) ?? newest.text, MAX_TEXT) };
}
