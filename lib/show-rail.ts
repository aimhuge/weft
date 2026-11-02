// The show rail beside the browser pane's page (components/ShowRail.tsx): one mini per turn of
// the open thread, and one per page the pane showed, oldest first like the chat. A pure projection of the thread's
// items and the pages visited this session; nothing is stored.
import { clip, shortToolName, timeAgo } from "./format";
import { extractStatus } from "./status";
import type { ThreadItem } from "./types";

export type Dot = "ok" | "wait" | "err" | "usr" | "page";
// id is "t" + the index of the turn's first item; the chat tags that item's row with it (data-turn).
// A page mini ("page" dot) carries its url and the turn it belongs to, which the chat scrolls to.
// A turn or message carries the page that was on screen then: for a turn, the last one it showed.
export type Mini = { id: string; dot: Dot; text: string; at: number; time: string; url?: string; turn?: string };
// A page you opened in the pane yourself (a link, the address bar, Back): the thread doesn't record those.
export type Visit = { url: string; at: number };

const MAX_TEXT = 90;
const MAX_COMMAND = 24;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;

export const turnId = (index: number) => `t${index}`;

// Markdown down to plain words, so three lines at 10 px say something.
export function plain(text: string) {
  return extractStatus(text)
    .text.replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(IMAGE, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function siteLabel(u: URL) {
  const last = u.pathname.split("/").filter(Boolean).at(-1);
  return last ? `/${decodeURIComponent(last)}` : u.host;
}

function fileLabel(pathname: string) {
  const parts = decodeURIComponent(pathname).split("/").filter(Boolean);
  const name = (parts.at(-1) ?? "").replace(/\.html?$/, "");
  const dir = parts.at(-2);
  return name === "index" && dir ? dir : name;
}

const fileName = (path: string) => path.split("/").filter(Boolean).slice(-2).join("/");

type Tool = Extract<ThreadItem, { kind: "tool" }>;

// What a turn with no prose did, so its mini never draws blank.
function toolLine(tool: Tool) {
  const name = shortToolName(tool.name);
  if (name === "Bash") return `Bash · ${clip(tool.summary.trim(), MAX_COMMAND)}`;
  if (/^(Edit|Write|MultiEdit|NotebookEdit|Read)$/.test(name)) return `${name} · ${fileName(tool.summary.trim())}`;
  if (name === "Grep" || name === "Glob") return `${name} · ${clip(tool.summary.trim(), MAX_COMMAND)}`;
  return clip(name, MAX_COMMAND);
}

// A page's name under its picture, short enough for 64 px (its full url is the tooltip): "show-rail#live"
// for show-rail/index.html#live, "plan" for plan.html, "/settings" for localhost:3000/settings, "weft.zip" for a site's home.
export function pageLabel(url: string) {
  try {
    const u = new URL(url);
    // A page a worker card saved (blob:sha256:…) has no name of its own to show, only its content hash.
    if (u.protocol === "blob:") return `page${u.hash}`;
    return `${u.protocol === "file:" ? fileLabel(u.pathname) : siteLabel(u)}${u.hash}`;
  } catch {
    return url;
  }
}

type Turn = { start: number; at: number; items: ThreadItem[]; pagesFrom: number };

function agentDot(items: ThreadItem[], live: boolean): Dot {
  const result = items.findLast((i) => i.kind === "result");
  if (result?.isError) return "err";
  // A turn that ends on a failed tool call broke; one it recovered from doesn't count.
  const last = items.findLast((i) => i.kind !== "result");
  if (last?.kind === "tool" && last.isError) return "err";
  if (live) return "wait";
  const asked = items.some((i) => i.kind === "permission" && (i.toolName === "AskUserQuestion" || !i.decision));
  const reply = items.findLast((i) => i.kind === "assistant");
  const status = reply && extractStatus(reply.text).status;
  if (asked || status?.column === "needs_you" || (reply && plain(reply.text).endsWith("?"))) return "wait";
  return "ok";
}

function agentText(items: ThreadItem[]) {
  const prose = items.find((i) => i.kind === "assistant" && plain(i.text));
  if (prose?.kind === "assistant") return plain(prose.text);
  const tool = items.find((i): i is Tool => i.kind === "tool");
  if (tool) return toolLine(tool);
  const result = items.find((i) => i.kind === "result" && plain(i.text));
  return result?.kind === "result" ? plain(result.text) : "Working…";
}

function userText(text: string) {
  const words = plain(text);
  return words || (/!\[[^\]]*\]\([^)]*\)/.test(text) ? "📎 attachment" : "…");
}

// live: the thread's newest turn is still running, or waiting on the user. visits: pages opened by hand, oldest first.
export function showMinis(items: readonly ThreadItem[], { live = false, now = Date.now(), visits = [] as readonly Visit[] } = {}): Mini[] {
  const minis: Mini[] = [];
  let turn: Turn | undefined;
  let lastTurn: string | undefined;
  const mini = (start: number, dot: Dot, text: string, at: number) =>
    minis.push({ id: turnId(start), dot, text: clip(text, MAX_TEXT), at, time: ago(at, now) });
  const close = (isLast: boolean) => {
    if (!turn) return;
    // The turn's mini goes before the pages it opened, which already sit at the end of the list.
    const pages = minis.splice(turn.pagesFrom);
    mini(turn.start, agentDot(turn.items, live && isLast), agentText(turn.items), turn.at);
    minis.push(...pages);
    lastTurn = turnId(turn.start);
    turn = undefined;
  };
  items.forEach((item, index) => {
    if (item.kind === "edited") return;
    if (item.kind === "user" || item.kind === "shell") {
      close(false);
      // The page on screen as you sent it (a review step's, one you opened) is history too.
      if (item.kind === "user" && item.page) minis.push(page(`m${index}`, item.page, item.at, lastTurn, now));
      mini(index, "usr", item.kind === "user" ? userText(item.text) : `! ${item.command}`, item.at);
      return;
    }
    turn ??= { start: index, at: item.at, items: [], pagesFrom: minis.length };
    turn.items.push(item);
    if (item.kind === "tool" && item.name === "mcp__browser__open_url") minis.push(page(`p${index}`, item.summary.trim(), item.at, turnId(turn.start), now));
  });
  close(true);
  return withPages(withVisits(minis, visits, now));
}

const ago = (at: number, now: number) => timeAgo(at, now).replace(" ago", "");

function page(id: string, url: string, at: number, turn: string | undefined, now: number): Mini {
  return { id, dot: "page", text: clip(pageLabel(url), MAX_TEXT), at, time: ago(at, now), url, turn };
}

// Visits slot in by time, each with the turn before it; a page that's already the latest one adds nothing.
function withVisits(minis: Mini[], visits: readonly Visit[], now: number) {
  const out = [...minis];
  for (const visit of visits) {
    const after = out.findIndex((m) => m.at > visit.at);
    const before = after < 0 ? out : out.slice(0, after);
    if (before.findLast((m) => m.dot === "page")?.url === visit.url) continue;
    const turn = before.findLast((m) => m.dot !== "page")?.id;
    out.splice(after < 0 ? out.length : after, 0, page(`v${visit.at}`, visit.url, visit.at, turn, now));
  }
  let shown: string | undefined;
  return out.filter((m) => {
    if (m.dot !== "page") return true;
    const repeat = m.url === shown;
    shown = m.url;
    return !repeat;
  });
}

// Each turn and message gets the page on screen at the time, so clicking it puts the pane back there too.
function withPages(minis: Mini[]) {
  let shown: string | undefined;
  return minis.map((m, i) => {
    if (m.dot === "page") {
      shown = m.url;
      return m;
    }
    const own = m.dot === "usr" ? undefined : minis.slice(i + 1).findLast((p) => p.dot === "page" && p.turn === m.id);
    const url = own?.url ?? shown;
    return url ? { ...m, url } : m;
  });
}

// Where the pane goes when the chat settles with turn id at its top: that turn's page, or at the end
// of the chat the newest page; undefined when the pane already shows it or there's none.
export function followUrl(minis: readonly Mini[], id: string, bottom: boolean, pageUrl: string) {
  const url = bottom ? minis.findLast((m) => m.dot === "page")?.url : minis.find((m) => m.id === id)?.url;
  return url && url !== pageUrl ? url : undefined;
}
