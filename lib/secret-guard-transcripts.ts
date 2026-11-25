// YOLO opens the CLI's transcripts to read (2026-11-25). A groovenfill card that needed the user's past prompts to turn
// into lessons had to send them to run `find ~/.claude/projects -name '*.jsonl'` in their own Terminal: the secret guard
// seals all of `~/.claude`, and it runs as a PreToolUse hook whatever the permission mode. A thread the user has put in
// YOLO (permissionMode bypassPermissions, read from the hook input's own `permission_mode`, so a mid-thread switch counts
// on the next tool call) may now read anything under `~/.claude/projects/` with Read, Grep, Glob, LS and read-only Bash.
//
// Only reads open. Writing into `~/.claude` (settings*.json, hooks, transcripts), `~/.claude.json`, `.env` files, Weft's
// own data dir and env dumps stay sealed in every mode: a thread that could write them could grant itself permissions.
// For Bash that's two steps: a line that names a transcript path must be made of commands that only read (or write
// outside `~/.claude`), and then each transcript path is swapped for a stand-in in /tmp so the rest of the guard reads
// what's left, as lib/secret-guard-own-project.ts does for a session's own project folder.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseShell, type SimpleCommand } from "./shell-parse";
import { cliHomes } from "./secret-guard-cli-home";
import { stripPrefixes, unwrapEnv } from "./secret-guard-bash";
import { inTranscriptDir } from "./secret-guard-files";

export const YOLO_MODE = "bypassPermissions";
export const isYolo = (mode: string | undefined) => mode === YOLO_MODE;

function real(at: string): string {
  try {
    return fs.realpathSync(at);
  } catch {
    return at;
  }
}

// macOS folds case, so `~/.CLAUDE` is the same folder.
const under = (at: string, dir: string) => {
  const rel = path.relative(dir.toLowerCase(), at.toLowerCase());
  return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// Whether an absolute path is the CLI's projects folder or in it, both where it's named and where it really lands: a link
// in there to `~/.claude/settings.json` stays sealed. A `..` anywhere in the name is refused before it's folded.
export function inCliProjects(at: string): boolean {
  if (!at || /(?:^|\/)\.\.(?:\/|$)/.test(at)) return false;
  const dirs = cliHomes(real).map((home) => path.join(home, "projects"));
  return [at, real(at)].every((p) => dirs.some((d) => under(p, d)));
}

// A path in a shell command that runs through the CLI's projects folder, the folder itself included.
const PROJECTS_PATH = /(?:~|\$HOME|\$\{HOME\}|\/)[^\s'"`;|&<>()]*\/\.claude\/projects(?:\/[^\s'"`;|&<>()]*)?/gi;

const pathsIn = (word: string) => word.match(PROJECTS_PATH) ?? [];

// Commands that only read what they're given, and shell words that run nothing of their own.
const READ_ONLY = new Set(
  ("cat bat less more head tail tac nl rev grep egrep fgrep rg ag ack awk gawk cut uniq wc jq yq column fold fmt " +
    "strings xxd od hexdump diff cmp sdiff comm ls file stat du tree basename dirname realpath readlink test [ [[ ] ]] " +
    "echo printf true false read for done fi esac").split(" "),
);
// Keywords in front of a command, as the shell parser leaves them: `do jq …`, `then ls …`.
const KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "{", "}"]);
const SHELLS = new Set("sh bash zsh dash ksh fish".split(" "));
const INTERPRETERS = new Set("node python python3 bun deno tsx".split(" "));
const XARGS_VALUED = new Set(["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a", "-J", "-R"]);
// Calls that write, move, delete or run something, and what they're called on.
const WRITE_CALL =
  /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|rmSync|rm|unlinkSync|unlink|renameSync|rename|copyFileSync|copyFile|cpSync|truncateSync|truncate|mkdirSync|symlinkSync|symlink|linkSync|remove|rmtree|move|copyfile|copy2?|makedirs|system|run|call|Popen|popen|exec|execSync|execFileSync|spawn|spawnSync|check_call|check_output)\s*\(([^)]*)\)/g;
const OPEN_FOR_WRITE = /\bopen\s*\(([^)]*['"][rb]*[wax+][^'"]*['"][^)]*)\)/g;
const RECEIVER_WRITE = /([\w.]*(?:\([^)]*\))?)\s*\.\s*(write_text|write_bytes|unlink|touch|rename|replace|mkdir|rmdir)\s*\(/g;
const ASSIGNED = /\b(\w+)\s*=\s*[^;\n]*\.claude/g;

const home = (w: string) => w.replace(/^["']|["']$/g, "").replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, os.homedir());

// Whether a word a command writes to lands outside the CLI's home. One built at run time (`"$f"`, `/tmp/x-$i`) is judged
// by the folder its fixed start names; a word with no fixed folder (`"$f"`) could be anywhere, so it isn't safe.
function safeTarget(word: string, place: (file: string) => string): boolean {
  const w = home(word);
  const dynamic = /[$`*?[]/.exec(w);
  const fixed = dynamic ? w.slice(0, dynamic.index) : w;
  if (dynamic && !fixed.includes("/")) return false;
  // A project's memory folder is open to write in every mode; the rest of the CLI's home isn't (inTranscriptDir).
  return !inTranscriptDir(place(dynamic ? fixed.slice(0, fixed.lastIndexOf("/") + 1) : fixed));
}

// Inline code that writes into the CLI's home, by name or through a variable set to it. Writing to /tmp is fine.
function codeWrites(code: string): boolean {
  const vars = [...code.matchAll(ASSIGNED)].map((m) => m[1] as string);
  const touches = (text: string) => /\.claude/i.test(text) || vars.some((v) => new RegExp(`\\b${v}\\b`).test(text));
  const calls = [...code.matchAll(WRITE_CALL)].map((m) => m[2] as string);
  const opens = [...code.matchAll(OPEN_FOR_WRITE)].map((m) => m[1] as string);
  const receivers = [...code.matchAll(RECEIVER_WRITE)].map((m) => m[1] as string);
  return [...calls, ...opens, ...receivers].some(touches);
}

const flags = (args: string[]) => args.filter((a) => !a.startsWith("-"));

// The command xargs or find -exec runs on the names it's given.
function innerOf(cmd: string, args: string[]): string[][] {
  if (cmd === "xargs") {
    let i = 0;
    while (args[i]?.startsWith("-")) i += XARGS_VALUED.has(args[i] as string) ? 2 : 1;
    return [args.slice(i)];
  }
  const inner: string[][] = [];
  args.forEach((a, at) => {
    if (!/^-(exec|execdir|ok|okdir)$/.test(a)) return;
    const end = args.findIndex((b, j) => j > at && (b === ";" || b === "+"));
    inner.push(args.slice(at + 1, end < 0 ? undefined : end));
  });
  return inner;
}

// One command on a transcript line, for the checks below.
interface Call {
  cmd: string;
  args: string[];
  stdin: string[];
  place: (file: string) => string;
  depth: number;
}

// Each check says whether a command writes (true), passes on a nested script's own reason (a string), or only reads.
type Check = (call: Call) => boolean | string | null;

const shellCheck: Check = ({ args, stdin, place, depth }) => {
  const c = args.indexOf("-c");
  const inline = c >= 0 && args[c + 1] ? [args[c + 1] as string] : [];
  return [...stdin, ...inline].map((s) => transcriptWrites(s, place, depth + 1)).find(Boolean) ?? null;
};
const namesCheck: Check = ({ cmd, args, place, depth }) =>
  (cmd === "find" && args.some((a) => /^-(delete|fprint0?|fprintf|fls)$/.test(a))) ||
  (innerOf(cmd, args)
    .map((inner) => notARead(inner, [], place, depth))
    .find(Boolean) ??
    null);
const copyCheck: Check = ({ args, place }) => args.some((a) => /^(-t|--target-directory)/.test(a)) || !safeTarget(flags(args).at(-1) ?? "", place);
const targetsCheck: Check = ({ args, place }) => !flags(args).every((a) => safeTarget(a, place));
const codeCheck: Check = ({ args, stdin }) => codeWrites([...args, ...stdin].join("\n"));

const CHECKS: Record<string, Check> = {
  eval: ({ args, place, depth }) => transcriptWrites(args.join(" "), place, depth + 1),
  sed: ({ args }) => args.some((a) => /^(-[a-zA-Z]*i|--in-place)/.test(a)),
  sort: ({ args }) => args.some((a) => /^(-o|--output)/.test(a)),
  find: namesCheck,
  xargs: namesCheck,
  ...Object.fromEntries([...SHELLS].map((s) => [s, shellCheck])),
  ...Object.fromEntries(["cp", "rsync", "ditto"].map((s) => [s, copyCheck])),
  ...Object.fromEntries(["tee", "mkdir", "cd", "pushd"].map((s) => [s, targetsCheck])),
  ...Object.fromEntries([...INTERPRETERS].map((s) => [s, codeCheck])),
};

// Why one command on a transcript line isn't a read, or null when it only reads (or writes outside `~/.claude`).
function notARead(words: string[], stdin: string[], place: (file: string) => string, depth: number): string | null {
  let run = unwrapEnv(stripPrefixes(words));
  while (KEYWORDS.has(run[0] ?? "")) run = run.slice(1);
  if (!run.length) return null;
  const cmd = path.basename(run[0] as string);
  if (READ_ONLY.has(cmd)) return null;
  // Anything not known to read, by name, writes.
  const check = CHECKS[cmd] ?? (() => true);
  const verdict = check({ cmd, args: run.slice(1), stdin, place, depth });
  return verdict === true ? `\`${cmd}\`` : verdict || null;
}

// Why a line that names a transcript path is turned away: it writes into the CLI's projects folder, by a redirect or a
// command that isn't a read. Lines that name none pass untouched. Checked in every mode, before any path is swapped.
export function transcriptWrites(command: string, place: (file: string) => string, depth = 0): string | null {
  if (depth > 5 || !/\.claude\/projects/i.test(command)) return null;
  const { commands, nested } = parseShell(command);
  const sealed = (p: string) => inCliProjects(place(p)) && inTranscriptDir(place(p));
  const names = commands.some((c: SimpleCommand) => c.words.some((w) => pathsIn(w).some(sealed)));
  for (const c of commands) {
    const out = c.outputs.find((f) => !safeTarget(f, place));
    if (out && (names || inCliProjects(place(home(out))))) return writeRefusal(out);
    const why = names ? notARead(c.words, c.stdin, place, depth) : null;
    if (why) return writeRefusal(why);
  }
  return nested.map((n) => transcriptWrites(n, place, depth + 1)).find(Boolean) ?? null;
}

// The command with each transcript path swapped for a stand-in in /tmp, keeping its name (`.env` stays `.env`), so the
// rest of the guard reads what's left. Paths that only name `~/.claude/projects` but land elsewhere stay as they were.
export function withoutTranscripts(command: string, place: (file: string) => string): string {
  if (!/\.claude\/projects/i.test(command)) return command;
  return command.replace(PROJECTS_PATH, (file) => (inCliProjects(place(file)) ? `/tmp/transcripts/${path.basename(file)}` : file));
}

export const writeRefusal = (what: string) =>
  `${what} would write into the CLI's own folder (~/.claude), which stays sealed in every mode: its settings and hooks decide ` +
  "what a thread may do. YOLO opens transcripts (~/.claude/projects/) to read only: print to stdout, or write to /tmp.";
