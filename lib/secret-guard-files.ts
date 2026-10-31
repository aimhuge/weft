// Tells whether a path is a file a thread is not allowed to read: .env / .envrc / .dev.vars,
// Weft's own sign-in token, device key, vault, sealed third-party tokens, and the control
// server's token. Brace and glob expansion are bounded so a 1 MB heredoc doesn't freeze the
// server's hook (2026-10-12).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "./store";
import { workerDataDir, workerHome, workRoot } from "./worker-config";

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

// The path as it stands: home spelled out, no trailing slash, so `/Users/me/.weft/` and `/Users/me/.weft`
// are the same path and the one below another.
function normalized(file: string): string {
  const clean = file.replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  return clean.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, os.homedir());
}

// The folder a relative path starts from: the card's, while a hook checks a call (`fromCwd`). The server's own
// folder is the wrong one: on a worker the daemon runs in its Weft clone, so `cat ../../worker.json` from a
// checkout landed on nothing (2026-10-30).
let cardCwd: string | undefined;

export function fromCwd<T>(cwd: string | undefined, check: () => T): T {
  const before = cardCwd;
  cardCwd = cwd;
  try {
    return check();
  } finally {
    cardCwd = before;
  }
}

// A `cd` moves where the rest of the line's relative paths start: `cd ..; cd ..; cat worker.json`.
export function followCd(words: string[]) {
  if (!cardCwd || !["cd", "pushd"].includes(words[0] ?? "")) return;
  const to = words.slice(1).find((w) => !w.startsWith("-"));
  cardCwd = to ? placed(normalized(to)) : os.homedir();
}

const placed = (clean: string) => path.resolve(cardCwd ?? process.cwd(), clean);

export function isSecretFile(file: string, dataDir = DATA_DIR, dotGlob = false): boolean {
  const clean = normalized(file);
  if (PROC_ENV.test(clean)) return true;
  const inWeft = /\/\.weft\/(.+)$/i.exec(clean)?.[1];
  const inData = path.relative(dataDir, placed(clean));
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

// The data dir's subfolders a thread may read and write. `show/` holds the pages threads render in
// the pane (plans, commits, how-tos, answers): it is the one place the BROWSER_PROMPT tells a thread to
// write, so sealing it made the pane's own pages unreadable and unwritable (2026-10-28). `apps/` holds
// the data mini apps (`apps/<slug>/index.html`, `weft-app.json`), which name vault secrets by name only;
// sealing it stopped threads building or editing one such as Growth (2026-10-29). `scout/` is the refactor
// scout's cache (lib/scout.ts): findings about code, which /weft:done reads and writes (2026-10-31).
// Everything else in the data dir — threads/, vault/, apps.json, app-grants.json, the control token — stays
// sealed; attachments/ opens one file at a time, to the card whose user pasted it (lib/secret-guard-pasted.ts).
export const DATA_OPEN = /^(show|apps|scout)(\/.*)?$/i;

// Whether a path inside the data dir (relative to it) is in an open folder: `..` is folded first, so
// `apps/../vault` is `vault`, and a path that climbs out of the data dir is never open.
function isOpen(rel: string): boolean {
  const folded = path.posix.normalize(rel);
  return !folded.startsWith("..") && !path.posix.isAbsolute(folded) && DATA_OPEN.test(folded);
}

// Where a path really lands: symlinks followed, even a dangling one (a write through `apps/x ->
// ../vault/new.json` would create a file in the vault), and a path that doesn't exist yet taken from
// its nearest existing folder. Bounded, so a symlink loop ends.
function realPlace(file: string, depth = 0): string {
  if (depth > 32) return loopPlace(file);
  try {
    return fs.realpathSync(file);
  } catch {
    const parent = path.dirname(file);
    try {
      if (fs.lstatSync(file).isSymbolicLink()) return realPlace(path.resolve(parent, fs.readlinkSync(file)), depth + 1);
    } catch {
      // Not there at all: fall through to its folder.
    }
    return path.join(realPlace(parent, depth + 1), path.basename(file));
  }
}

// Where a loop gave up: its link's folder really placed, so `/var` reads `/private/var` on macOS as the root does.
function loopPlace(file: string): string {
  try {
    return path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
  } catch {
    return file;
  }
}

// An open folder holding a symlink into a sealed one (`apps/x -> ../vault`) must not let a thread
// through: the path's real place is checked too. A link out of the data dir (`apps/x -> ~/.claude`, or
// to a project's `.env`) is checked as the file it lands on.
function realPlaceSealed(resolved: string, root: string): boolean {
  const real = realPlace(resolved);
  const rel = path.relative(realPlace(root), real);
  if (!rel) return true;
  // A path that went nowhere stays sealed: asking again about the same path never ended (2026-10-30).
  if (rel.startsWith("..") || path.isAbsolute(rel)) return real === resolved || isSecretFile(real, root);
  return !isOpen(rel);
}

// Whether a path is the data dir or inside it, save for the folders threads may use. A path that
// names the dir, or that reaches it by walking up (`~/.weft/threads`), is the data dir.
export function reachesDataDir(file: string, dataDir = DATA_DIR): boolean {
  const clean = normalized(file);
  if (!clean) return false;
  if (reachesWorkerHome(clean)) return true;
  const resolved = placed(clean);
  const root = path.resolve(dataDir);
  if (resolved === root) return true;
  const rel = path.relative(root, resolved);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return !isOpen(rel) || realPlaceSealed(resolved, root);
  // A `~`-relative path the guard can't resolve to a real folder: the name still says `.weft`.
  if (/(?:^|\/)\.weft(?:\/|$)/i.test(clean)) {
    // `~/.weft/show/...` is a thread's own pane page, `~/.weft/apps/...` a mini app.
    const inWeft = /(?:^|\/)\.weft\/(.+)$/i.exec(clean)?.[1] ?? "";
    return !isOpen(inWeft);
  }
  return false;
}

const within = (file: string, dir: string) => {
  const rel = path.relative(dir, file);
  return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// What a thread may use in a worker's home. Its checkouts, its pane pages and mini apps, and the clone of Weft
// itself: that's a public repo, and /weft:done runs its commit.sh from the plugin inside it. The rest is sealed
// whole, as the data dir is: worker.json (the key), worker.env (the Claude token), seal-key.json,
// github-credentials, worker.log and whatever a later build puts there.
function sealedInHome(file: string, home: string, root: string): boolean {
  if (!within(file, home) || within(file, root) || within(file, path.join(home, "weft"))) return false;
  const rel = path.relative(workerDataDir(home), file);
  return rel.startsWith("..") || !isOpen(rel);
}

// A path that spells the home by name: `$H/.weft-worker/worker.json`, which can't be resolved, or `~/.weft-w*/x`
// beside the real one. macOS opens a name in any case.
function namesHome(clean: string, home: string, root: string): boolean {
  const name = path.basename(home);
  const parts = clean.split("/");
  const at = parts.findIndex((part, i) => {
    if (part.toLowerCase() === name.toLowerCase()) return true;
    return /[*?[]/.test(part) && globRegex(part, false).test(name) && placed(i ? parts.slice(0, i).join("/") || "/" : ".") === path.dirname(home);
  });
  return at >= 0 && sealedInHome(path.join(home, ...parts.slice(at + 1)), home, root);
}

// Whether a path reaches a Weft Worker's home on this machine (docs/architecture/weft-worker.md#whats-sealed-on-a-worker).
// The folder gate is no seal: it asks, and Always opens the home to every card, so the refusal has to be here.
// A machine with no such home skips all of it, which keeps `grep .weft-worker` working on a Mac that only talks to one.
export function reachesWorkerHome(file: string, home = workerHome(), root = workRoot(home)): boolean {
  if (!fs.existsSync(home)) return false;
  const clean = normalized(file);
  if (!clean) return false;
  const at = placed(clean);
  // Its real place too: a checkout is a repo somebody else wrote, and it can hold a link to `../../worker.json`.
  return sealedInHome(at, home, root) || sealedInHome(realPlace(at), realPlace(home), realPlace(root)) || namesHome(clean, home, root);
}

// Whether a path is the CLI's transcript dir or inside it: `~/.claude`, `~/.claude.json`, or any
// file under `~/.claude/projects/…`. A path that names the dir by name only (`~/.claude/…`) counts,
// because that dir is the same folder wherever the home is.
export function inTranscriptDir(file: string): boolean {
  const clean = normalized(file);
  if (/(?:^|\/)\.claude\.json$/i.test(clean)) return true;
  return /(?:^|\/)\.claude(?:\/|$)/i.test(clean);
}
