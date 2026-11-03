// Which `.claude` folders are the CLI's own. Its home (`~/.claude`) holds every transcript, and its settings and hooks
// decide what a thread may do, so it stays sealed. A project's checked-in `.claude/` (skills, agents, commands) is just
// the repo: the guard used to seal every `.claude` it saw, so a card couldn't read its own project's skills (2026-11-03).
// A project's settings*.json still can't be changed by a thread: its hooks are the guard itself (Weft's own runs it).

import os from "node:os";
import path from "node:path";

// Any home's `.claude`, named outright: on a worker the CLI may run as another user, and `/Users/x/.claude` is that
// user's transcripts wherever this server's own home is.
const ANY_HOME = /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root|\/var\/root)\/\.claude(?:\/|$)/i;
// One path segment that is `.claude`.
export const CLAUDE_SEGMENT = /(?:^|\/)\.claude(?:\/|$)/i;

// macOS folds case, so `~/.CLAUDE` is the same folder.
const under = (file: string, dir: string) => {
  const rel = path.relative(dir.toLowerCase(), file.toLowerCase());
  return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// The CLI's own folders: `~/.claude`, where it really is (a dotfiles link), and CLAUDE_CONFIG_DIR when one is set.
export function cliHomes(real: (p: string) => string): string[] {
  const dirs = [path.join(os.homedir(), ".claude")];
  if (process.env.CLAUDE_CONFIG_DIR) dirs.push(path.resolve(process.env.CLAUDE_CONFIG_DIR));
  return [...new Set(dirs.flatMap((d) => [d, real(d)]))];
}

// Whether an absolute path is in one of them, by where it's named or where it really lands: a project's `.claude`
// that links into `~/.claude` is the CLI's folder.
export function inCliHome(at: string, real: (p: string) => string): boolean {
  const homes = cliHomes(real);
  return [at, real(at)].some((p) => ANY_HOME.test(p) || homes.some((d) => under(p, d)));
}

// Whether a search from this folder walks into the CLI's own: `Glob .claude/** in ~` does, one in a project doesn't.
export function holdsCliHome(root: string, real: (p: string) => string): boolean {
  return cliHomes(real).some((d) => under(d, root) || under(d, real(root)));
}

const SETTINGS = /^settings(?:\.[^/]*)?\.json$/i;
const SETTINGS_NAMES = ["settings.json", "settings.local.json"];
const globTest = (glob: string, name: string) =>
  new RegExp(`^${glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`, "i").test(name);
const isName = (word: string, re: RegExp, names: string[]) => re.test(word) || (/[*?]/.test(word) && names.some((n) => globTest(word, n)));

// A `.claude/settings*.json` in any folder, or a glob in it that reaches one (`.claude/*.json`). With folder, the `.claude`
// folder itself counts too: Bash can't say whether it reads or writes, and `rm -rf .claude` or `cp -r x/ .claude`
// changes the settings in it without naming them.
export function changesCliSettings(file: string, folder = false): boolean {
  const clean = path.posix.normalize(file.replace(/^["']|["']$/g, "").replace(/\/+$/, ""));
  const base = path.posix.basename(clean);
  // The folder by its own name only: `ls .*` and `ls *` are everyday listings, not a reach for the settings.
  if (folder && /^\.claude$/i.test(base)) return true;
  return /^\.claude$/i.test(path.posix.basename(path.posix.dirname(clean))) && isName(base, SETTINGS, SETTINGS_NAMES);
}

export const SETTINGS_REFUSAL = (name: string) =>
  `${name} is a CLI settings file: its permissions and hooks decide what a thread may do (Weft's guard runs from one), ` +
  "so a thread can't change it. The Read tool opens a project's `.claude/` files; ask the user to change its settings.";
