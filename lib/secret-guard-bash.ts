// Why a shell command is turned away (or null to let it run). The check works through the
// `Call` interface: one simple command at a time, with its args, stdin fed by upstream
// pipes, and a depth counter so a script nested many shells deep still terminates.

import path from "node:path";
import { blankCommand, parseShell, type SimpleCommand } from "./shell-parse";
import { DATA_DIR } from "./store";
import { DATA_NAMES, expandBraces, followCd, inTranscriptDir, isSecretFile, reachesDataDir } from "./secret-guard-files";

// Commands that print, copy out or send what they read.
const READERS = new Set(
  ("cat bat less more head tail tac nl rev grep egrep fgrep rg ag ack awk gawk sed cut sort uniq strings xxd od hexdump base64 " +
    "diff cmp sdiff jq yq column fold fmt paste join comm look expand unexpand split csplit tar zip gzip bzip2 xz zstd dd curl wget " +
    "openssl gpg vi vim nvim view ex emacs nano").split(" "),
);
// Run their arguments or stdin as code: `node -e` with a path in it, a heredoc fed to python.
const INTERPRETERS = new Set("python python3 node ruby perl php deno bun tsx ts-node osascript".split(" "));
const SHELLS = new Set("sh bash zsh dash ksh fish eval".split(" "));
// Copy, move or link: reading the copy next would get past the name check, so the source counts as read.
const COPIERS = new Set("cp mv ln rsync scp install ditto".split(" "));
// Their first argument is a pattern or script, not a file: `grep .env .gitignore` reads .gitignore.
const PATTERN_FIRST = new Set("grep egrep fgrep rg ag ack sed awk gawk".split(" "));
const GIT_READS = new Set(["show", "diff", "blame", "cat-file", "grep"]);
// Words in front of the command that don't change what it reads.
const PREFIXES = new Set(["sudo", "command", "exec", "time", "nohup", "nice", "builtin", "{", "}", "!"]);
// Code that prints the whole environment: `console.log(process.env)`, `print(os.environ)`, Perl's %ENV.
const ENV_CODE = /process\.env\b(?!\s*(\.\w|\[))|os\.environ\b(?!\s*(\[|\.get\b))|%ENV\b|\bENV\.(to_h|to_a|to_s|each|inspect|keys|values|map|select|sort)\b/;
// `echo $STRIPE_SECRET_KEY` and the like.
const SECRET_VAR = /\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)\w*/i;
const XARGS_VALUED = new Set(["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a", "-J", "-R"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

const nameOf = (words: string[]) => path.basename(words[0] ?? "");

// `FOO=1 sudo env -u X cmd` runs cmd.
export function stripPrefixes(words: string[]): string[] {
  let i = 0;
  const skip = (w = "") => ASSIGNMENT.test(w) || PREFIXES.has(w);
  while (i < words.length && skip(words[i])) i++;
  return words.slice(i);
}

export function unwrapEnv(words: string[]): string[] {
  if (nameOf(words) !== "env") return words;
  let i = 1;
  const option = (w = "") => w.startsWith("-") || ASSIGNMENT.test(w);
  while (i < words.length && option(words[i])) i += words[i] === "-u" ? 2 : 1;
  return words.slice(i);
}

const lists = (args: string[]) => args.every((a) => /^-[a-zA-Z]*[px]/.test(a));
const printsSecretVar = (args: string[]) => args.some((a) => SECRET_VAR.test(a));
const DUMPS: Record<string, (args: string[]) => boolean> = {
  printenv: () => true,
  set: (args) => args.length === 0,
  env: (args) => args.every((a) => a.startsWith("-")),
  export: lists,
  declare: lists,
  typeset: lists,
  // ps shows every process's environment with BSD-style `e` or -E.
  ps: ([first = "", ...rest]) => (!first.startsWith("-") && first.includes("e")) || [first, ...rest].some((a) => /^-[a-zA-Z]*E/.test(a)),
  echo: printsSecretVar,
  printf: printsSecretVar,
};

function dumpsEnvironment(words: string[]): boolean {
  return DUMPS[nameOf(words)]?.(words.slice(1)) ?? false;
}

function pullsToStdout([cmd, sub, verb, ...rest]: string[]): boolean {
  return cmd === "vercel" && sub === "env" && verb === "pull" && rest.some((a) => a === "-" || a.startsWith("/dev/"));
}

// The pieces of a word that could be a path: `HEAD:.env`, `if=.env`, `@.env`, `readFileSync('.env')`.
function pathTokens(word: string): string[] {
  return expandBraces(word)
    .flatMap((w) => w.split(/[\s=:@,()'"`;<>|&]+/))
    .filter(Boolean);
}

// Every secret name above has one of these in it, or a glob reaches it; the rest skip path.resolve.
const MAYBE_SECRET = new RegExp(`env|dev\\.vars|${DATA_NAMES.map((n) => n.split(".")[0]).join("|")}|[*?[]`, "i");

// A path that is the data dir or the CLI's transcript dir, whatever else is in it. These hold
// the control server's token and every secret a thread ever saw, so they are named by their
// folder, not by a file inside them (2026-10-28).
function hardPathIn(words: string[], dataDir: string): string | undefined {
  const seen = new Set<string>();
  for (const word of words) {
    for (const t of pathTokens(word)) {
      if (seen.has(t)) continue;
      seen.add(t);
      if (reachesDataDir(t, dataDir) || inTranscriptDir(t)) return t;
    }
  }
  return undefined;
}

// Each distinct token once: a 1 MB heredoc is ~600k tokens but only a few thousand different ones.
function secretIn(words: string[], dataDir: string): string | undefined {
  const seen = new Set<string>();
  for (const word of words) {
    for (const t of pathTokens(word)) {
      if (seen.has(t)) continue;
      seen.add(t);
      if (MAYBE_SECRET.test(t) && isSecretFile(t, dataDir)) return t;
    }
  }
  return undefined;
}

// The command xargs or find -exec runs on the names it's given.
function innerCommand(cmd: string, args: string[]): string[] {
  if (cmd === "xargs") {
    let i = 0;
    while (args[i]?.startsWith("-")) i += XARGS_VALUED.has(args[i] ?? "") ? 2 : 1;
    return args.slice(i);
  }
  const at = args.findIndex((a) => /^-(exec|execdir|ok|okdir)$/.test(a));
  if (at < 0) return [];
  const end = args.findIndex((a, j) => j > at && (a === ";" || a === "+"));
  return args.slice(at + 1, end < 0 ? undefined : end);
}

// node, bun and deno load --env-file without printing it, unless there's inline code to print it with.
function envFileArgs(args: string[]): { files: string[]; rest: string[]; inline: boolean } {
  const files: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const m = /^--env-file(-if-exists)?(=(.*))?$/.exec(args[i] ?? "");
    if (!m) rest.push(args[i] ?? "");
    else files.push(m[2] ? (m[3] ?? "") : (args[++i] ?? ""));
  }
  return { files, rest, inline: rest.some((a) => /^(-e|-p|-pe|--eval|--print)$/.test(a)) };
}

// What one command is about to do, for the checks below.
interface Call {
  cmd: string;
  args: string[];
  stdin: string[];
  dataDir: string;
  depth: number;
  // Whether a secret is named anywhere on the line, for xargs and find, whose names arrive from elsewhere.
  namesSecret: () => boolean;
}

const hitReason = (hit: string | undefined) => (hit ? reason(hit) : null);

// `-e 's/.env/x/'` is a sed script or grep pattern, not a file; `-f script.sed` is a file.
const SCRIPT_FLAG = /^(-e|--regexp|--expression)$/;
const SCRIPT_GIVEN = /^(-e|-f|--regexp|--expression|--file)(=|$)/;

function readerVerdict({ cmd, args, dataDir }: Call): string | null {
  if (!PATTERN_FIRST.has(cmd)) return hitReason(secretIn(args, dataDir));
  const scripts = new Set(args.flatMap((a, j) => (SCRIPT_FLAG.test(a) ? [j + 1] : /^--(regexp|expression)=/.test(a) ? [j] : [])));
  // Without -e, the first plain argument, past sed -i's empty '' suffix on macOS.
  if (!args.some((a) => SCRIPT_GIVEN.test(a))) scripts.add(args.findIndex((a) => a !== "" && !a.startsWith("-")));
  return hitReason(
    secretIn(
      args.filter((_, j) => !scripts.has(j)),
      dataDir,
    ),
  );
}

function shellVerdict({ cmd, args, stdin, dataDir, depth }: Call): string | null {
  const c = args.indexOf("-c");
  const inline = args[c + 1];
  const scripts = cmd === "eval" ? [args.join(" ")] : [...stdin, ...(c >= 0 && inline ? [inline] : [])];
  return scripts.map((s) => bashVerdict(s, dataDir, depth + 1)).find(Boolean) ?? null;
}

function runsOnNamesVerdict(call: Call): string | null {
  const inner = innerCommand(call.cmd, call.args);
  const runs = nameOf(inner);
  if ((READERS.has(runs) || INTERPRETERS.has(runs) || SHELLS.has(runs)) && call.namesSecret()) return reason("a `.env` file", true);
  return inner.length ? commandVerdict({ ...blankCommand(), words: inner }, call.dataDir, call.depth, call.namesSecret) : null;
}

// Calls that open, load or shell out to what they're given: `open('.env')`, `readFileSync(p)`,
// `Path('.env').read_text()`, `dotenv_values(...)`, `subprocess.run(['cat', '.env'])`, Ruby and Perl's backticks.
const OPENS = new RegExp(
  "\\b(open|fopen|file|read|read_?text|read_?bytes|readlines|readFileSync|readFile|createReadStream|readTextFile(Sync)?|" +
    "file_get_contents|foreach|Path|join|resolve|config|load_dotenv|dotenv_values|load|system|popen|Popen|run|call|" +
    "check_output|check_call|getoutput|exec|execSync|execFileSync|spawn|spawnSync|qx)\\s*\\(([^)]*)",
  "g",
);
const BACKTICKS = /`([^`]*)`/g;
// `p = '.env.local'`: a variable set to the path itself, opened by name later on.
const ASSIGNED = /=\s*[rbfu]?(['"`])([^'"`\n]*)\1/gi;
// Flags whose next argument is inline code.
const CODE_FLAG = /^(-c|-e|-E|-p|-pe|-ne|-r|--eval|--print)$/;

// Inline code reads a .env file when it opens one, not when its text merely mentions one:
// `s.replace('.env.local', '.env.test')` edits a file, `print(open('.env.local').read())` reads one.
function codeReads(cmd: string, code: string, dataDir: string): string | undefined {
  if (cmd === "osascript") return secretIn([code], dataDir);
  const opened = [...code.matchAll(OPENS)].map((m) => m[3] as string);
  const shelled = cmd === "ruby" || cmd === "perl" ? [...code.matchAll(BACKTICKS)].map((m) => m[1] as string) : [];
  const named = opened.length ? [...code.matchAll(ASSIGNED)].map((m) => m[2] as string).find((v) => isSecretFile(v, dataDir)) : undefined;
  return secretIn([...opened, ...shelled], dataDir) ?? named;
}

function interpreterVerdict({ cmd, args, stdin, dataDir }: Call): string | null {
  if ([...args, ...stdin].some((a) => ENV_CODE.test(a))) return ENV_DUMP;
  const { files, rest, inline } = envFileArgs(args);
  const code = new Set(rest.flatMap((a, j) => (CODE_FLAG.test(a) ? [j + 1] : [])));
  const inCode = [...stdin, ...rest.filter((_, j) => code.has(j))].map((c) => codeReads(cmd, c, dataDir)).find(Boolean);
  const named = secretIn(
    rest.filter((_, j) => !code.has(j)),
    dataDir,
  );
  return hitReason(inCode ?? named ?? (inline ? secretIn(files, dataDir) : undefined));
}

function copierVerdict({ args, dataDir }: Call): string | null {
  return hitReason(secretIn(args.filter((a) => !a.startsWith("-")).slice(0, -1), dataDir));
}

// git only with a subcommand that shows file contents; log only with a patch.
function gitVerdict(call: Call): string | null {
  const sub = call.args.find((a) => !a.startsWith("-")) ?? "";
  const shows = GIT_READS.has(sub) || (sub === "log" && call.args.some((a) => /^(-p|-u|--patch)$/.test(a)));
  return shows ? readerVerdict(call) : null;
}

// Package runners that run a command of their own: `pnpm exec cat .env`, `npx cat .env`. The
// child is invisible to a guard that only reads the line, so it is re-parsed as a command
// (2026-10-28).
const EXEC_RUNNERS = new Set(["npx", "bunx", "pnpx", "dlx"]);
// The runners whose `exec` (or `dlx`) subcommand runs a command: `pnpm exec`, `npm exec`, `yarn exec`.
const EXEC_SUBCOMMANDS = new Set(["pnpm", "npm", "yarn", "bun"]);

// The words of the command a package runner runs, or null when it runs none.
export function execRunnerChild(cmd: string, args: string[]): string[] | null {
  if (EXEC_RUNNERS.has(cmd)) return args.filter((a) => !a.startsWith("-"));
  if (!EXEC_SUBCOMMANDS.has(cmd)) return null;
  const at = args.findIndex((a) => a === "exec" || a === "dlx");
  if (at < 0) return null;
  return args.slice(at + 1).filter((a) => !a.startsWith("-"));
}

function verdictFor(cmd: string): ((call: Call) => string | null) | null {
  if (SHELLS.has(cmd)) return shellVerdict;
  if (cmd === "xargs" || cmd === "find") return runsOnNamesVerdict;
  if (INTERPRETERS.has(cmd)) return interpreterVerdict;
  if (COPIERS.has(cmd)) return copierVerdict;
  if (cmd === "git") return gitVerdict;
  return READERS.has(cmd) ? readerVerdict : null;
}

// Why one simple command is turned away.
function commandVerdict({ words: raw, inputs, stdin }: SimpleCommand, dataDir: string, depth: number, namesSecret: () => boolean): string | null {
  const redirected = inputs.find((f) => isSecretFile(f, dataDir));
  if (redirected) return reason(redirected);
  const words = stripPrefixes(raw);
  if (dumpsEnvironment(words)) return ENV_DUMP;
  if (pullsToStdout(words)) return reason("`vercel env pull` to stdout", true);
  // A folder that holds secrets, named as a folder: `find ~/.weft -exec cat {} \;` and
  // `rsync -a ~/.weft/ /tmp/b/` name no secret file, but reach one (2026-10-28).
  // The raw words, so `H=~/.weft-worker; cat $H/worker.json` counts.
  const hard = hardPathIn([...raw, ...inputs], dataDir);
  if (hard) return reason(hard);
  const [first = "", ...args] = unwrapEnv(words);
  const cmd = path.basename(first);
  const own = verdictFor(cmd)?.({ cmd, args, stdin, dataDir, depth, namesSecret }) ?? null;
  if (own) return own;
  return execChildVerdict(cmd, args, dataDir, depth, namesSecret);
}

// A package runner's child is a command of its own: `pnpm exec cat .env` reads the file
// even though the line only names the runner (2026-10-28).
function execChildVerdict(cmd: string, args: string[], dataDir: string, depth: number, namesSecret: () => boolean): string | null {
  const child = execRunnerChild(cmd, args);
  if (!child?.length) return null;
  const [childCmd = "", ...childArgs] = child;
  const name = path.basename(childCmd);
  const inner = verdictFor(name)?.({ cmd: name, args: childArgs, stdin: [], dataDir, depth, namesSecret }) ?? null;
  if (inner) return inner;
  const hit = hardPathIn(childArgs, dataDir) ?? secretIn(childArgs, dataDir);
  return hit ? reason(hit) : null;
}

// Why a shell command is turned away, or null to let it run.
export function bashVerdict(command: string, dataDir = DATA_DIR, depth = 0): string | null {
  if (depth > 5) return null;
  const { commands, nested } = parseShell(command);
  // A heredoc piped along (`cat <<EOF | bash`) reaches whatever runs it.
  let carried: string[] = [];
  const piped = commands.map((c) => {
    const fed = { ...c, stdin: [...carried, ...c.stdin] };
    carried = c.pipes ? fed.stdin : [];
    return fed;
  });
  const namesSecret = () => commands.some((c) => secretIn([...c.words, ...c.inputs], dataDir) !== undefined);
  return (
    piped
      .map((c) => {
        const why = commandVerdict(c, dataDir, depth, namesSecret);
        followCd(stripPrefixes(c.words));
        return why;
      })
      .find(Boolean) ??
    nested.map((n) => bashVerdict(n, dataDir, depth + 1)).find(Boolean) ??
    null
  );
}

// A file is named by its base name; literal text goes in as it is.
function reason(what: string, literal = false): string {
  const name = literal ? what : `\`${path.basename(what.replace(/^["']|["']$/g, ""))}\``;
  return (
    `Weft keeps secret values out of threads, so ${name} can't be read here. Work with names instead: ` +
    "read or edit `.env.example`, and ask the user to set the value themselves."
  );
}

export const ENV_DUMP =
  "Weft keeps secret values out of threads, so dumping the environment or printing a secret variable is blocked. " +
  'To check one variable is set without printing it: `test -n "$NAME" && echo set`.';
