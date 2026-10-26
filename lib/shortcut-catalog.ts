import { keyCaps, SHORTCUT_GROUPS, type ShortcutGroup, type ShortcutInfo } from "./hotkeys";

// Everything the "?" dialog lists. The registry (./hotkeys) holds the board's own keys; the rest are handled
// where they apply (the composer, the reply box, the terminal, the palette) or by the desktop app menu
// (electron/main.cjs), so they're written down here. Keep this in step when one of those changes.

export type CatalogEntry = ShortcutInfo & {
  // Only the desktop app has it (the app menu or a global hotkey).
  desktop?: boolean;
};

export type ShortcutSection = { group: ShortcutGroup; items: CatalogEntry[] };

// Keys the desktop app menu adds to a registered shortcut, so "N" and "⌘N" share one row.
export const MENU_ALIASES: Record<string, string> = {
  "new-thread": "mod+n",
  filter: "mod+f",
  copilot: "mod+j",
  browser: "mod+shift+b",
  terminal: "ctrl+`",
  settings: "mod+,",
};

export const FIXED_SHORTCUTS: CatalogEntry[] = [
  { id: "palette-next", keys: ["ctrl+n"], description: "Next result in the command palette", group: "General" },
  { id: "palette-previous", keys: ["ctrl+p"], description: "Previous result in the command palette", group: "General" },
  { id: "reply-send", keys: ["Enter"], description: "Send a reply, or queue it while a turn runs", group: "Thread" },
  { id: "reply-newline", keys: ["shift+Enter"], description: "New line in a reply", group: "Thread" },
  { id: "reply-edit-queued", keys: ["ArrowUp"], description: "Edit your last message, or the last queued one (empty reply box)", group: "Thread" },
  { id: "reply-send-later", keys: ["alt+Enter"], description: "Send a reply later (Enter again: at the 5-hour reset)", group: "Thread" },
  { id: "reply-stop", keys: ["ctrl+c"], description: "Stop the running turn (in the reply box)", group: "Thread" },
  { id: "close-thread", keys: ["Escape"], description: "Close the open thread or dialog", group: "Thread" },
  { id: "toggle-view", keys: ["Escape"], description: "Switch between board and list view (with nothing open)", group: "General" },
  { id: "new-send", keys: ["mod+Enter"], description: "Start the new thread", group: "Writing" },
  { id: "new-send-stay", keys: ["ctrl+Enter"], description: "Start the new thread and keep the dialog open for another (macOS)", group: "Writing" },
  { id: "new-backlog", keys: ["mod+b"], description: "Add the new thread to the Backlog (in the New thread dialog)", group: "Writing" },
  { id: "skill", keys: ["/"], description: "Run a skill (type / at the start of a message)", group: "Writing" },
  { id: "bold", keys: ["mod+b"], description: "Bold (except in the New thread dialog)", group: "Writing" },
  { id: "italic", keys: ["mod+i"], description: "Italic", group: "Writing" },
  { id: "strike", keys: ["mod+shift+s"], description: "Strikethrough", group: "Writing" },
  { id: "inline-code", keys: ["mod+e"], description: "Inline code", group: "Writing" },
  { id: "terminal-split", keys: ["mod+\\"], description: "Split the terminal", group: "Terminal & browser" },
  { id: "zoom-in", keys: ["mod++"], description: "Zoom in", group: "Terminal & browser", desktop: true },
  { id: "zoom-out", keys: ["mod+-"], description: "Zoom out", group: "Terminal & browser", desktop: true },
  { id: "zoom-reset", keys: ["mod+0"], description: "Actual size", group: "Terminal & browser", desktop: true },
  { id: "show-board", keys: ["mod+1"], description: "Show the board window", group: "App", desktop: true },
  { id: "show-copilot", keys: ["mod+2"], description: "Show the copilot window", group: "App", desktop: true },
  { id: "global-copilot", keys: ["ctrl+alt+ "], description: "Summon the copilot from any app", group: "App", desktop: true },
  { id: "reload", keys: ["mod+r"], description: "Reload", group: "App", desktop: true },
  { id: "close-window", keys: ["mod+w"], description: "Close the window", group: "App", desktop: true },
  { id: "full-screen", keys: ["ctrl+mod+f"], description: "Full screen", group: "App", desktop: true },
];

// The dialog's sections: registered shortcuts (with their menu keys on desktop), then the fixed ones, in
// SHORTCUT_GROUPS order. dictation is the user's own key for it (lib/shortcuts.ts), as a key spec.
export function shortcutSections(
  registered: ShortcutInfo[],
  { desktop, dictation }: { desktop: boolean; dictation?: string },
): ShortcutSection[] {
  const fromRegistry = registered.map((s): CatalogEntry => {
    const alias = desktop ? MENU_ALIASES[s.id] : undefined;
    return alias && !s.keys.includes(alias) ? { ...s, keys: [...s.keys, alias] } : s;
  });
  const fixed = FIXED_SHORTCUTS.filter((s) => desktop || !s.desktop);
  if (dictation) fixed.push({ id: "dictation", keys: [dictation], description: "Start or stop dictation", group: "Writing" });
  const all = [...fromRegistry, ...fixed];
  const groups = [...SHORTCUT_GROUPS, ...new Set(all.map((s) => s.group).filter((g) => !SHORTCUT_GROUPS.includes(g)))];
  return groups.map((group) => ({ group, items: all.filter((s) => s.group === group) })).filter((s) => s.items.length > 0);
}

// Names a key cap answers to in a search, beyond its own text.
const CAP_NAMES: Record<string, string[]> = {
  "⌘": ["cmd", "command", "mod"],
  "⌃": ["ctrl", "control"],
  "⌥": ["alt", "option", "opt"],
  "⇧": ["shift"],
  Ctrl: ["ctrl", "control", "mod"],
  Alt: ["alt", "option"],
  Shift: ["shift"],
  Esc: ["escape"],
  Enter: ["return", "↵"],
  "↑": ["up", "arrow"],
  "↓": ["down", "arrow"],
  "←": ["left", "arrow"],
  "→": ["right", "arrow"],
  Space: ["spacebar"],
};

// Words a search can match on an entry's keys: each cap, its names, and each whole combo ("⌘k", "ctrl+k").
function keyWords(entry: CatalogEntry, mac: boolean): Set<string> {
  const words = new Set<string>();
  for (const spec of entry.keys) {
    const caps = keyCaps(spec, mac);
    words.add(caps.join("").toLowerCase());
    words.add(caps.join("+").toLowerCase());
    for (const cap of caps) {
      words.add(cap.toLowerCase());
      for (const name of CAP_NAMES[cap] ?? []) words.add(name);
    }
  }
  return words;
}

// The sections holding only entries every typed word matches: part of the description or group, or a key
// by name ("cmd", "esc", "⌘k", "j").
export function filterSections(sections: ShortcutSection[], query: string, mac: boolean): ShortcutSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections;
  return sections
    .map(({ group, items }) => ({
      group,
      items: items.filter((entry) => {
        const text = `${entry.description} ${group}`.toLowerCase();
        const keys = keyWords(entry, mac);
        return words.every((w) => text.includes(w) || keys.has(w));
      }),
    }))
    .filter((s) => s.items.length > 0);
}

// A description split into what the key does and the fine print, so the dialog can dim the fine print:
// "Stop the running turn (in the reply box)" → "Stop the running turn" + "in the reply box";
// "Library: recipes, to-dos and notes" → "Library" + "recipes, to-dos and notes".
export function splitDescription(description: string): { main: string; detail?: string } {
  const [, main, detail] = description.match(/^(.+?) \((.+)\)$/) ?? [];
  if (main && detail) return { main, detail };
  const colon = description.indexOf(": ");
  if (colon > 0) return { main: description.slice(0, colon), detail: description.slice(colon + 2) };
  return { main: description };
}
