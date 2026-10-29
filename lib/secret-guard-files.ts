// Tells whether a path is a file a thread is not allowed to read: .env / .envrc / .dev.vars,
// Weft's own sign-in token, device key, vault, sealed third-party tokens, and the control
// server's token. Brace and glob expansion are bounded so a 1 MB heredoc doesn't freeze the
// server's hook (2026-10-12).

import path from "node:path";
import { DATA_DIR } from "./store";

// .env, .env.local, .env.production.local, direnv's .envrc, Wrangler's .dev.vars, and globs like .env*.
// Any case: macOS opens .ENV.LOCAL as .env.local.
export const SECRET_FILE = /^(\.env([.*?[].*)?|\.envrc|\.dev\.vars)$/i;
// Files that list names with placeholder values.
export const TEMPLATE = /\.(example|sample|template|dist|defaults)$/i;
// Weft's own files in the data dir: the sign-in token, the device key, the vault (ciphertext, but
// threads have no reason to read it), the sealed Vercel, Supabase, Cloudflare and Slack tokens, and the
// control server's token.
export const DATA_SECRET = /^(account\.json|device-key\.json|vercel-token\.json|supabase-token\.json|cloudflare-token\.json|slack-token\.json|shell-token|vault(\/.*)?)$/i;
// A process's environment, on Linux.
export const PROC_ENV = /^\/proc\/[^/]+\/environ$/;
// What a glob like `.e*` or `account*` is tried against.
export const SECRET_NAMES = [".env", ".env.local", ".env.development.local", ".env.production", ".env.production.local", ".envrc", ".dev.vars"];
export const DATA_NAMES = ["account.json", "device-key.json", "vercel-token.json", "supabase-token.json", "cloudflare-token.json", "slack-token.json", "shell-token", "vault"];
// The CLI's own transcripts: every secret value a thread ever saw is written there in plaintext,
// outside Weft's redaction path (which covers only ~/.weft/threads) (2026-10-28).
export const TRANSCRIPT_DIR = ".claude";

// A glob as a regex. As in the shell, a leading * or ? skips dotfiles unless dotGlob (ripgrep's globs don't).
function globRegex(glob: string, dotGlob: boolean): RegExp {
  const body = glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\[!/g, "[^");
  try {
    return new RegExp(`^${dotGlob || glob.startsWith(".") ? "" : "(?!\\.)"}${body}$`, "i");
  } catch {
    return /$^/;
  }
}

// Brace expansion multiplies: a heredoc of code with 25 `{a, b}` groups is 2^25 words, which froze the
// board's server for good (2026-10-12). Past this many words, or this much text (256 copies of a 1 MB
// heredoc is still 300 MB), the glob's pieces are checked one by one.
const MAX_EXPANSIONS = 256;
const MAX_EXPANDED_CHARS = 64_000;
const GROUP = /\{([^{}]*)\}/g;

const alternatives = (group: RegExpExecArray) => (group[1] ?? "").split(",");

// One word with all its innermost groups expanded in one pass, so a script's many `{ ... }` blocks cost one copy.
function expandGroups({ word, groups }: { word: string; groups: RegExpExecArray[] }): string[] {
  let heads = [""];
  let at = 0;
  for (const m of groups) {
    const before = word.slice(at, m.index);
    heads = heads.flatMap((head) => alternatives(m).map((alt) => head + before + alt));
    at = m.index + m[0].length;
  }
  return heads.map((head) => head + word.slice(at));
}

// `{.env,.env.local}` as each name it stands for.
export function expandBraces(glob: string): string[] {
  let words = [glob];
  for (;;) {
    const found = words.map((word) => ({ word, groups: [...word.matchAll(GROUP)] }));
    if (found.every((f) => f.groups.length === 0)) return words;
    const counts = found.map((f) => f.groups.reduce((k, m) => k * alternatives(m).length, 1));
    const total = counts.reduce((n, k) => n + k, 0);
    const chars = found.reduce((n, f, i) => n + (counts[i] as number) * f.word.length, 0);
    if (total > MAX_EXPANSIONS || chars > MAX_EXPANDED_CHARS) return [glob.replace(/[{},]/g, " ")];
    words = found.flatMap(expandGroups);
  }
}

// The name itself, or a glob that reaches one of the known names.
function matchesName(name: string, pattern: RegExp, names: string[], dotGlob: boolean): boolean {
  if (pattern.test(name)) return true;
  if (!/[*?[]/.test(name)) return false;
  const glob = globRegex(name, dotGlob);
  return names.some((n) => glob.test(n));
}

// The path as it stands: `~` for home, no trailing slash, so `/Users/me/.weft/` and `/Users/me/.weft`
// are the same path and the one below another.
function normalized(file: string): string {
  const clean = file.replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  return clean.replace(/^~(?=\/|$)/, "");
}

export function isSecretFile(file: string, dataDir = DATA_DIR, dotGlob = false): boolean {
  const clean = normalized(file);
  if (PROC_ENV.test(clean)) return true;
  const inWeft = /\/\.weft\/(.+)$/i.exec(clean)?.[1];
  const inData = path.relative(dataDir, path.resolve(clean));
  if ([inWeft, inData].some((p) => p && matchesName(p, DATA_SECRET, DATA_NAMES, dotGlob))) return true;
  // The data dir itself, and anything under it. It holds the control server's token, so reaching
  // into it is reaching the master key: `find ~/.weft -exec cat {} \;` names no file at all, and a
  // walk that finds one at run time must not slip past the name check (2026-10-28).
  if (reachesDataDir(clean, dataDir)) return true;
  // The CLI's own transcript dir: every secret value a thread ever saw is in there, in plaintext.
  if (inTranscriptDir(clean)) return true;
  const base = path.basename(clean);
  return matchesName(base, SECRET_FILE, SECRET_NAMES, dotGlob) && !TEMPLATE.test(base);
}

// The data dir's subfolders a thread may read and write: `show/` holds the pages threads render in
// the pane (plans, commits, how-tos, answers). It is the one place the BROWSER_PROMPT tells a
// thread to write, so sealing it made the pane's own pages unreadable and unwritable (2026-10-28).
// Everything else in the data dir — threads/, vault/, apps/, attachments/ — stays sealed.
export const DATA_OPEN = /^show(\/.*)?$/i;

// Whether a path is the data dir or inside it, save for the folders threads may use. A path that
// names the dir, or that reaches it by walking up (`~/.weft/threads`), is the data dir.
export function reachesDataDir(file: string, dataDir = DATA_DIR): boolean {
  const clean = normalized(file);
  if (!clean) return false;
  const resolved = path.resolve(clean);
  const root = path.resolve(dataDir);
  if (resolved === root) return true;
  const rel = path.relative(root, resolved);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return !DATA_OPEN.test(rel);
  // A `~`-relative path the guard can't resolve to a real folder: the name still says `.weft`.
  if (/(?:^|\/)\.weft(?:\/|$)/i.test(clean)) {
    // `~/.weft/show/...` is a thread's own pane page.
    const inWeft = /(?:^|\/)\.weft\/(.+)$/i.exec(clean)?.[1] ?? "";
    return !DATA_OPEN.test(inWeft);
  }
  return false;
}

// Whether a path is the CLI's transcript dir or inside it: `~/.claude`, `~/.claude.json`, or any
// file under `~/.claude/projects/…`. A path that names the dir by name only (`~/.claude/…`) counts,
// because that dir is the same folder wherever the home is.
export function inTranscriptDir(file: string): boolean {
  const clean = normalized(file);
  if (/(?:^|\/)\.claude\.json$/i.test(clean)) return true;
  return /(?:^|\/)\.claude(?:\/|$)/i.test(clean);
}
