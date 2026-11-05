import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalSingleton } from "./global-singleton";
import { looksScratch } from "./scratch";
import { DATA_DIR, listCards } from "./store";
import type { Welcome } from "./welcome-types";

// First launch's welcome (components/WelcomeDialog.tsx): whether your Claude Code history counts on
// your Wefter Profile, and which projects' sessions become cards. Until it's answered the session
// sync adds no cards (lib/import-sync.ts). Kept in ~/.weft/welcome.json, apart from settings.json.

// The welcome's shape lives in lib/welcome-types.ts (types only, no node:fs), so the board's welcome
// dialog can name it without dragging this module into the browser chunk. Re-exported here: the
// server's own imports of "./welcome" keep working.
export type { Welcome };

export const WELCOME_FILE = path.join(DATA_DIR, "welcome.json");

const state = () => globalSingleton<{ loaded: boolean; welcome: Welcome | null }>("__weftWelcome", () => ({ loaded: false, welcome: null }));

function parse(text: string): Welcome | null {
  try {
    const raw = JSON.parse(text) as Partial<Welcome> | null;
    if (!raw || typeof raw.at !== "number") return null;
    return {
      at: raw.at,
      countHistory: raw.countHistory !== false,
      fresh: raw.fresh === true,
      skip: Array.isArray(raw.skip) ? raw.skip.filter((s): s is string => typeof s === "string") : [],
      ...(raw.legacy ? { legacy: true } : {}),
      ...(raw.test ? { test: true } : {}),
    };
  } catch {
    return null;
  }
}

// The saved answer, or null while the welcome is still waiting.
export function welcome(): Welcome | null {
  const s = state();
  if (!s.loaded) {
    s.welcome = fs.existsSync(WELCOME_FILE) ? parse(fs.readFileSync(WELCOME_FILE, "utf8")) : null;
    s.loaded = true;
  }
  return s.welcome;
}

export function saveWelcome(next: Welcome) {
  fs.mkdirSync(path.dirname(WELCOME_FILE), { recursive: true });
  fs.writeFileSync(WELCOME_FILE, JSON.stringify(next, null, 2));
  Object.assign(state(), { loaded: true, welcome: next });
}

// The answer, adopting a board that already has cards so people who used Weft before this never see
// the welcome. Null means a new install that hasn't answered yet.
export function welcomeOrAdopt(): Welcome | null {
  const saved = welcome();
  if (saved) return saved.test ? null : saved;
  const cards = listCards().filter((c) => c.role !== "copilot");
  if (!cards.length) return null;
  // History is what came before your first card in Weft itself; picked-up sessions don't count as that.
  const own = cards.filter((c) => c.source !== "claude-code").map((c) => c.createdAt);
  const adopted: Welcome = { at: own.length ? Math.min(...own) : Date.now(), countHistory: true, fresh: false, skip: [], legacy: true };
  saveWelcome(adopted);
  return adopted;
}

const inside = (folder: string, cwd: string) => cwd === folder || cwd.startsWith(folder.endsWith("/") ? folder : `${folder}/`);

// Settings → General's "Test it": the real welcome shows again, past the adoption guard, on a board
// that already has cards. Answering it saves a new answer without the flag.
export function testWelcome() {
  const w = welcomeOrAdopt() ?? { at: Date.now(), countHistory: true, fresh: false, skip: [] };
  saveWelcome({ ...w, test: true });
}

// Whether the welcome is waiting because of "Test it".
export const testingWelcome = () => welcome()?.test === true;

// Whether a session not on the board yet should become a card: never while the welcome waits, and
// not from a skipped folder or, after Start fresh, from before the welcome.
export function importsSession(w: Welcome | null, cwd: string, lastActivity: number): boolean {
  if (!w) return false;
  if (w.skip.some((folder) => inside(folder, cwd))) return false;
  return !w.fresh || lastActivity >= w.at;
}

// Whether something that happened at `at` counts on the profile.
export function countsAt(w: Welcome | null, at: number): boolean {
  return !w || w.countHistory || at >= w.at;
}

// Scratch folders (lib/scratch.ts) and the OS temp folder: the welcome leaves them unticked.
export function isScratch(cwd: string): boolean {
  return cwd.startsWith(os.tmpdir()) || looksScratch(cwd);
}

// Settings → General: count your history or not, after the welcome.
export function setCountHistory(on: boolean) {
  const w = welcomeOrAdopt() ?? { at: Date.now(), countHistory: on, fresh: false, skip: [] };
  saveWelcome({ ...w, countHistory: on });
}

// Settings → General: bring in every Claude Code session after all (undoes Start fresh and skips).
export function importAll() {
  const w = welcomeOrAdopt() ?? { at: Date.now(), countHistory: true, fresh: false, skip: [] };
  saveWelcome({ ...w, fresh: false, skip: [] });
}
