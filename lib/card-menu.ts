import { AGENT_ORDER, AGENTS, agentOf, type ThreadAgent } from "./agents";
import { isLive } from "./format";
import { permissionOptions, type Backend, type Card, type Column, type DevServerStatus, type PermissionMode } from "./types";
import { BACKENDS } from "./new-thread";

// The right-click menus on the board, as plain data: the board builds them, the desktop shell
// shows them natively (electron/main.cjs) and hands back the id of the item picked.
// Everything is one click: no submenus.

// checked shows a tick (the card's current permission mode). accelerator is the item's key (an Electron
// accelerator, e.g. "Shift+A"): drawn beside it, and pressing it while the menu is open picks the item.
export type MenuItem =
  | { id: string; label: string; enabled?: boolean; checked?: boolean; accelerator?: string }
  | { type: "separator" };

export type CardAction =
  | "open"
  | "rename"
  | "start"
  | `move:${Column}`
  | "stop"
  | `skill:${string}`
  | `mode:${PermissionMode}`
  | `switch:${Backend}`
  | `agent:${ThreadAgent}`
  | "dev:start"
  | "dev:restart"
  | "dev:stop"
  | "vault:grant"
  | "vault:revoke"
  | "new-here"
  | "reveal"
  | "copy-path"
  | "copy-resume"
  | "star"
  | "tags"
  | "share"
  | "archive"
  | "delete";

const SEPARATOR: MenuItem = { type: "separator" };

// Weft's own skills, offered on every card.
export const MENU_SKILLS = ["weft:done", "weft:commit", "weft:preview"];

// The key for the "Run on <CLI>" item at this position in BACKENDS. The first is plain J and the
// rest add a modifier, so every CLI gets a key no other item uses. Derived from the position
// rather than written out, so a CLI added to BACKENDS always gets one.
const SWITCH_MODIFIERS = ["", "Shift+", "Alt+", "Ctrl+"];

function switchKey(index: number) {
  return `${SWITCH_MODIFIERS[index] ?? `Ctrl+Shift+`}J`;
}

// Columns you can move a card to by hand (app/api/cards/[id]/route.ts); Running and Needs you follow the thread.
const MOVES: { column: Column; label: string }[] = [
  { column: "review", label: "Move to Review" },
  { column: "done", label: "Move to Done" },
  { column: "backlog", label: "Move to Backlog" },
];

// Every item's key while its menu is open, by item id. Items with a board shortcut get the board's key
// instead (components/use-board-menus.ts), so the two always agree. Letters are free here: the board's
// own keys don't run while a menu is open. Not Return, Escape, Space or arrows: the open menu uses those.
const MENU_KEYS: Record<string, string> = {
  open: "O",
  rename: "R",
  start: "S",
  "move:review": "V",
  "move:done": "D",
  "move:backlog": "B",
  stop: "X",
  "dev:start": "L",
  "dev:restart": "L",
  "dev:stop": "Shift+L",
  "mode:bypassPermissions": "Y",
  "mode:auto": "U",
  "mode:acceptEdits": "E",
  "mode:default": "M",
  // The "Run on <CLI>" keys, one per CLI the menu offers. Built from the same list the items come
  // from (BACKENDS), so a CLI added there always gets a key: a hand-written list went stale once
  // already, and the new item came out with no key at all.
  ...Object.fromEntries(BACKENDS.map((backend, i) => [`switch:${backend.id}`, switchKey(i)])),
  "agent:builder": "Shift+W",
  "agent:copywriter": "W",
  "new-here": "N",
  reveal: "F",
  "copy-path": "C",
  "copy-resume": "Shift+C",
  star: "K",
  tags: "G",
  share: "Shift+S",
  archive: "Shift+A",
  delete: "CmdOrCtrl+Backspace",
  // Column menus.
  new: "N",
  "toggle-archived": "H",
  "archive-done": "Shift+E",
  // The skills go 1, 2, 3 in MENU_SKILLS order.
  ...Object.fromEntries(MENU_SKILLS.map((skill, i) => [`skill:${skill}`, String(i + 1)])),
};

// dev is the card's dev server, when its review plan names one.
// access: whether the card has standing 🔐 vault access (electron/vault-grants.cjs), or undefined when the shell
// can't give it (a plain browser tab, an older shell), which leaves the item out.
export function cardMenu(card: Card, dev?: DevServerStatus | null, access?: boolean): MenuItem[] {
  const live = isLive(card);
  const items: MenuItem[] = [{ id: "open", label: "Open Thread" }, { id: "rename", label: "Rename…" }, SEPARATOR];

  if (card.column === "backlog") items.push({ id: "start", label: "Start Now" });
  for (const m of MOVES) {
    if (m.column !== card.column) items.push({ id: `move:${m.column}`, label: m.label, enabled: !live });
  }
  items.push(SEPARATOR);

  if (live) items.push({ id: "stop", label: "Stop Turn" });
  for (const skill of MENU_SKILLS) items.push({ id: `skill:${skill}`, label: `Run /${skill}`, enabled: !live });
  if (card.review?.dev) {
    const up = dev?.state === "running" || dev?.state === "starting" || Boolean(dev?.reachable);
    if (up) items.push({ id: "dev:restart", label: "Restart Dev Server" }, { id: "dev:stop", label: "Stop Dev Server" });
    else items.push({ id: "dev:start", label: "Start Dev Server" });
  }
  items.push(...vaultItems(access), SEPARATOR);

  // Applies mid-turn too; Codex maps these choices to its sandbox modes.
  for (const m of permissionOptions(card.backend)) {
    items.push({ id: `mode:${m.id}`, label: `Permissions: ${m.label}`, checked: card.permissionMode === m.id });
  }
  items.push(SEPARATOR);
  items.push(...switchItems(card, live), ...agentItems(card, live));
  items.push(SEPARATOR);

  items.push({ id: "new-here", label: "New Thread in This Folder" }, { id: "reveal", label: "Reveal Folder in Finder" });
  items.push({ id: "copy-path", label: "Copy Folder Path" });
  if (card.sessionId && card.backend === "claude") items.push({ id: "copy-resume", label: "Copy Resume Command" });
  items.push(SEPARATOR);

  items.push(...markItems(card), SEPARATOR);

  items.push({ id: "archive", label: card.archived ? "Unarchive" : "Archive" }, { id: "delete", label: "Delete…" });
  return withAccelerators(items, MENU_KEYS);
}

// Give or take back the card's standing 🔐 vault access: one Touch ID, then its fills, runs and dev server don't ask
// for an hour. Extracted to keep cardMenu's complexity in check.
function vaultItems(access: boolean | undefined): MenuItem[] {
  if (access === undefined) return [];
  return [access ? { id: "vault:revoke", label: "Revoke 🔐 Vault Access" } : { id: "vault:grant", label: "Give 🔐 Vault Access for 1 Hour" }];
}

// The "Run on <other>" menu item. Extracted to keep cardMenu's complexity in check.
function switchItems(card: Card, live: boolean): MenuItem[] {
  return BACKENDS.filter((backend) => backend.id !== card.backend).map((backend) => ({
    id: `switch:${backend.id}`,
    label: `Run on ${backend.label}${card.rateLimitHit ? " (hit plan limit)" : ""}`,
    enabled: !live,
  }));
}

// "Agent: <name>", ticked on the card's own: who the thread is (lib/agents.ts). A switch ends its CLI, so not mid-turn.
function agentItems(card: Card, live: boolean): MenuItem[] {
  const current = agentOf(card.agent).id;
  return AGENT_ORDER.map((id) => ({
    id: `agent:${id}`,
    label: `Agent: ${AGENTS[id].emoji} ${AGENTS[id].name}`,
    checked: current === id,
    enabled: !live || current === id,
  }));
}

// A starred card is never auto-archived. Tags are the card's own, or ones Weft picked (lib/tags.ts).
// Share… opens the card's link to weft.zip (components/ShareCardDialog.tsx).
function markItems(card: Card): MenuItem[] {
  return [{ id: "star", label: card.starred ? "Unstar" : "Star" }, { id: "tags", label: "Tags…" }, { id: "share", label: "Share…" }];
}

// What to paste in a terminal to pick the thread up in Claude Code.
export function resumeCommand(card: Card): string {
  return `cd ${shellQuote(card.cwd)} && claude --resume ${card.sessionId}`;
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export type ColumnAction = "new" | "toggle-archived" | "archive-done";

// Right-clicking a column's empty space.
export function columnMenu(column: Column, done: { count: number; archived: number; showArchived: boolean }): MenuItem[] {
  const items: MenuItem[] = [{ id: "new", label: "New Thread" }];
  if (column === "done") {
    if (done.archived > 0) items.push({ id: "toggle-archived", label: done.showArchived ? "Hide Archived" : `Show ${done.archived} Archived` });
    if (done.count > 0) items.push(SEPARATOR, { id: "archive-done", label: `Archive All ${done.count} in Done` });
  }
  return withAccelerators(items, MENU_KEYS);
}

// Gives items their keys, by item id (Electron accelerators); an id left out or undefined keeps its key.
export function withAccelerators(items: MenuItem[], keys: Record<string, string | undefined>): MenuItem[] {
  return items.map((item) => ("id" in item && keys[item.id] ? { ...item, accelerator: keys[item.id] } : item));
}
