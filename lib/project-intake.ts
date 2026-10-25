import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { shell } from "./browser-tools";
import { globalSingleton } from "./global-singleton";
import { envReads, findHook, isTemplate, templateNames, wantsBlank, type FoundHook } from "./intake-scan";
import { providerHint } from "./provider-hints";
import { listFiles, listSources, TEST } from "./quality-files";
import { DATA_DIR } from "./store";
import { addWebhook, DEFAULT_ORIGIN, listWebhooks } from "./webhooks";

// When a project opens on the board (lib/use-board-view.ts), Weft takes in what it can learn about its secrets
// and webhooks without a thread (docs/architecture/secrets.md#project-intake): its untracked .env files' new values
// go into the 🔐 vault, the env names its code reads and its .env.example lists come in as blanks with a hint
// saying where to get each, and the webhook routes it serves become 🪝 blanks. In the background, off the
// start-a-card path; once per folder until HEAD or an .env file changes. What an intake offered is remembered in
// ~/.weft/intake.json, so a blank or secret the user removed never comes back.

export type IntakeBlank = { name: string; hint?: string; source: string };

// What the board's intake screen lists (components/IntakeDialog.tsx): names, files, hints and routes, never a value.
export type IntakeDetails = {
  imported: { name: string; file: string }[];
  blanks: IntakeBlank[];
  hooks: FoundHook[];
};

export type IntakeResult = {
  // Values moved into the vault from these .env files.
  imported: number;
  importedFrom: string[];
  // Names now blanks in the vault, and webhooks now blanks in 🪝.
  blanks: number;
  hooks: number;
  // .env files git tracks that hold values the vault lacks: those are in history, so rotate, don't import.
  tracked: string[];
  // Left out when nothing was taken in.
  details?: IntakeDetails;
};

type VaultIntake = { imported?: { file: string; name: string }[]; blanked?: string[]; tracked?: string[]; keys?: string[] };

const MAX_BYTES = 200_000;
const MAX_BLANKS = 25;
const READ_BATCH = 64;

const offeredFile = () => path.join(DATA_DIR, "intake.json");
const NONE: IntakeResult = { imported: 0, importedFrom: [], blanks: 0, hooks: 0, tracked: [] };

function readOffered(): Record<string, string[]> {
  try {
    return (JSON.parse(fs.readFileSync(offeredFile(), "utf8")) as { offered?: Record<string, string[]> }).offered ?? {};
  } catch {
    return {};
  }
}

function remember(folder: string, keys: string[]) {
  if (!keys.length) return;
  const all = readOffered();
  all[folder] = [...new Set([...(all[folder] ?? []), ...keys])];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(offeredFile(), JSON.stringify({ offered: all }, null, 2));
}

function git(folder: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["-C", folder, ...args], { timeout: 5000 }, (err, out) => {
      resolve(err ? "" : out.trim());
    });
  });
}

// HEAD plus every root .env file's mtime: a commit or an edited .env.local means look again.
async function stampOf(folder: string): Promise<string> {
  let envs: string[] = [];
  try {
    envs = fs.readdirSync(folder).filter((f) => f.startsWith(".env")).sort();
  } catch {
    // A folder that's gone has nothing to take in; the stamp still settles.
  }
  const times = envs.map((f) => {
    try {
      return `${f}@${fs.statSync(path.join(folder, f)).mtimeMs}`;
    } catch {
      return f;
    }
  });
  return [await git(folder, ["rev-parse", "HEAD"]), ...times].join("\n");
}

async function readText(folder: string, rel: string): Promise<string> {
  try {
    const file = path.join(folder, rel);
    if ((await fs.promises.stat(file)).size > MAX_BYTES) return "";
    return await fs.promises.readFile(file, "utf8");
  } catch {
    return "";
  }
}

// Reads the sources a few dozen at a time, so a big repo never blocks the server's event loop for long.
async function readAll(folder: string, files: string[]): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (let i = 0; i < files.length; i += READ_BATCH) {
    const batch = files.slice(i, i + READ_BATCH);
    out.push(...(await Promise.all(batch.map(async (f): Promise<[string, string]> => [f, await readText(folder, f)]))));
  }
  return out;
}

/** What a project's files say: the blanks its code and templates want, and the webhooks it serves. */
export async function scanProject(folder: string): Promise<{ blanks: IntakeBlank[]; hooks: FoundHook[] }> {
  let files: string[] = [];
  try {
    files = listFiles(folder);
  } catch {
    // A folder that's gone (or was never there) has nothing to take in.
    return { blanks: [], hooks: [] };
  }
  const sources = await readAll(folder, listSources(files).filter((f) => !TEST.test(f)));
  const blanks = new Map<string, IntakeBlank>();
  const hooks: FoundHook[] = [];
  for (const [file, text] of sources) {
    for (const name of envReads(text)) {
      const hint = providerHint(name);
      if (blanks.has(name) || !wantsBlank(name, Boolean(hint))) continue;
      blanks.set(name, { name, hint: hint ? `${hint} (read in ${file})` : `Read in ${file}`, source: "your code" });
    }
    const hook = findHook(file, text);
    if (hook) hooks.push(hook);
  }
  for (const file of files.filter(isTemplate)) {
    for (const name of templateNames(await readText(folder, file))) {
      if (blanks.has(name)) continue;
      const hint = providerHint(name);
      blanks.set(name, { name, ...(hint && { hint }), source: file });
    }
  }
  return { blanks: [...blanks.values()].slice(0, MAX_BLANKS), hooks };
}

// The store keeps full localhost URLs (lib/webhooks.ts cleanTarget); the base lets a bare path through too.
function pathOf(target: string): string {
  return new URL(target, DEFAULT_ORIGIN).pathname;
}

// Adds each found webhook as a 🪝 blank unless the folder already has one by that name or route, or an earlier
// intake offered it. A second route from the same provider gets its path's segment in its name.
function addHooks(folder: string, found: FoundHook[], offered: Set<string>): { keys: string[]; added: FoundHook[] } {
  const keys: string[] = [];
  const added: FoundHook[] = [];
  const existing = listWebhooks([folder]);
  const names = new Set(existing.map((h) => h.name.toLowerCase()));
  const targets = new Set(existing.map((h) => pathOf(h.target)));
  for (const hook of found) {
    const key = `hook\n${hook.target}`;
    if (offered.has(key) || targets.has(hook.target)) continue;
    const segment = hook.target.split("/").filter((p) => p && p !== "api" && !/^webhooks?$/.test(p))[0] ?? "route";
    const name = names.has(hook.name) ? `${hook.name}-${segment}` : hook.name;
    if (names.has(name)) continue;
    try {
      addWebhook({ folder, ...hook, name });
    } catch {
      continue; // a route addWebhook won't take; the scan's guess was wrong, not the user's data
    }
    names.add(name);
    keys.push(key);
    added.push({ ...hook, name });
  }
  return { keys, added };
}

async function intake(folder: string): Promise<IntakeResult> {
  const offered = new Set(readOffered()[folder] ?? []);
  const { blanks, hooks } = await scanProject(folder);
  const { keys: hookKeys, added } = addHooks(folder, hooks, offered);
  // The vault lives in Electron main; on the web (no desktop shell) only the webhooks are taken in.
  const vault = (await shell("/secrets/intake", { folder, blanks, skip: [...offered] }).catch(() => ({}))) as VaultIntake;
  remember(folder, [...hookKeys, ...(vault.keys ?? [])]);
  const imported = (vault.imported ?? []).map(({ name, file }) => ({ name, file }));
  const blanked = new Set(vault.blanked ?? []);
  const details = { imported, blanks: blanks.filter((b) => blanked.has(b.name)), hooks: added };
  const result = { imported: imported.length, importedFrom: [...new Set(imported.map((i) => i.file))], blanks: blanked.size, hooks: added.length, tracked: vault.tracked ?? [] };
  return intakeText(result) ? { ...result, details } : result;
}

// The last stamp each folder was taken in at, and the run in flight, per server process.
const seen = globalSingleton("__weftIntakeSeen", () => new Map<string, string>());
const running = globalSingleton("__weftIntakeRunning", () => new Map<string, Promise<IntakeResult>>());

/** Takes a project in, or says nothing happened when it hasn't changed since the last time. */
export async function intakeProject(folder: string): Promise<IntakeResult> {
  const inFlight = running.get(folder);
  if (inFlight) return inFlight;
  // The run is registered before the first await, so a second call that lands while the stamp is being
  // read waits for this one instead of taking the project in twice.
  const run = (async () => {
    const stamp = await stampOf(folder);
    if (seen.get(folder) === stamp) return NONE;
    seen.set(folder, stamp);
    return intake(folder);
  })().finally(() => running.delete(folder));
  running.set(folder, run);
  return run;
}

/** A one-line summary of an intake, or null when nothing happened (the board's screen opens only when it isn't). */
export function intakeText(r: IntakeResult): string | null {
  const parts: string[] = [];
  if (r.imported) parts.push(`moved ${r.imported} secret${r.imported > 1 ? "s" : ""} from ${r.importedFrom.join(", ")} into 🔐`);
  if (r.blanks) parts.push(`added ${r.blanks} blank${r.blanks > 1 ? "s" : ""} to 🔐 for keys your code reads`);
  if (r.hooks) parts.push(`found ${r.hooks} webhook${r.hooks > 1 ? "s" : ""} for 🪝`);
  if (r.tracked.length) parts.push(`${r.tracked.join(", ")} ${r.tracked.length > 1 ? "are" : "is"} committed to git, so rotate those keys at the provider`);
  if (!parts.length) return null;
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
