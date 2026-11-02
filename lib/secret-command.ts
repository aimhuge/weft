import fs from "node:fs";
import path from "node:path";
import { parseShell } from "./shell-parse";

// Which commands a thread may run with vault values in their env (mcp__secrets__run, the dev server;
// docs/architecture/secrets.md). Electron main runs the command as argv, with no shell, so the line must be
// one plain command: no pipes, redirects, `;`, `&&`, `$VAR` or `$(…)`. On top of that, programs that would
// run code the user can't see in the approval (`sh -c`, `node -e`, `eval`), print the environment, or send
// data off the machine are turned away, since the values sit in their env.

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
// Outside single quotes these mean something to a shell, and nothing here runs one.
const META = new Set(["|", "&", ";", "<", ">", "(", ")", "`", "$", "\n", "\r"]);

// Control (Cc), format (Cf: zero-width and bidi controls) and line or paragraph separators: they make a command or a
// script show the user something other than what runs. electron/command-rules.cjs holds main to the same rule.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Whether text holds a character that would show differently from what it is; a script's own line breaks are fine. */
export function hasUnsafeText(text: string, lines = false): boolean {
  return UNSAFE.test(lines ? text.replace(/\n/g, "") : text);
}

// Variables that make a program load code the approval doesn't show: a preload library, Node's --require, a shell's
// startup file. Neither the command line nor a vault name may set one (electron/command-rules.cjs holds the same list).
export const LOADER_VAR = /^(NODE_OPTIONS|LD_[A-Z_]+|DYLD_[A-Z_]+|BASH_ENV|ENV|PYTHONSTARTUP|PERL5OPT|RUBYOPT)$/;

const SHELLS = new Set("sh bash zsh dash ksh fish csh tcsh eval exec source . osascript".split(" "));
// Run another command: what they run wouldn't be the command the user approved.
const WRAPPERS = new Set("env sudo doas xargs nohup time command builtin nice watch script parallel timeout stdbuf caffeinate".split(" "));
const DUMPS = new Set("printenv export set declare".split(" "));
const NETWORK = new Set("curl wget nc ncat netcat socat telnet ssh scp sftp ftp rsync http https xh aria2c".split(" "));
// Interpreters and the flags that hand them code inline (short letters may be bundled, as in `perl -pe`).
const INLINE: Record<string, { short: string; long: string[] }> = {
  node: { short: "ep", long: ["--eval", "--print"] },
  bun: { short: "ep", long: ["--eval", "--print"] },
  tsx: { short: "ep", long: ["--eval", "--print"] },
  "ts-node": { short: "ep", long: ["--eval", "--print"] },
  deno: { short: "", long: ["eval"] },
  python: { short: "c", long: [] },
  ruby: { short: "eE", long: [] },
  perl: { short: "eE", long: [] },
  php: { short: "r", long: [] },
  awk: { short: "", long: [] },
  gawk: { short: "", long: [] },
  npx: { short: "c", long: ["--call"] },
};
// Package runners and the words in front of a script's name.
const SCRIPT_RUNNERS: Record<string, { run: string[]; direct: string[] }> = {
  npm: { run: ["run", "run-script"], direct: ["test", "start", "stop", "restart"] },
  pnpm: { run: ["run"], direct: ["*"] },
  yarn: { run: ["run"], direct: ["*"] },
  bun: { run: ["run"], direct: [] },
};

export interface CheckedCommand {
  argv: string[];
  env: Record<string, string>;
}

// The first char that a shell would treat as syntax, outside quotes; a backslash escapes the next char.
function shellSyntax(command: string): string | undefined {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === "\\") i++;
    else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "$" || c === "`") return c;
    } else if (c === "'" || c === '"') quote = c;
    else if (META.has(c)) return c;
  }
  return quote ? quote : undefined;
}

function program(word: string): string {
  const base = path.basename(word);
  return /^python\d*(\.\d+)?$/.test(base) ? "python" : base;
}

// An interpreter's flags, up to its script: does one of them carry code inline?
function inlineCode(name: string, args: string[]): boolean {
  if (name === "awk" || name === "gawk") return true;
  const flags = INLINE[name];
  if (!flags) return false;
  for (const arg of args) {
    if (arg === "-") return true;
    if (flags.long.includes(arg.split("=")[0] as string)) return true;
    if (/^-[A-Za-z]+$/.test(arg) && arg.slice(1).split("").some((c) => flags.short.includes(c))) return true;
    if (!arg.startsWith("-")) return false;
  }
  return false;
}

// Package runners that start another program: what they start is checked as a command of its own ("" = no verb).
const RUNS_NEXT: Record<string, string[]> = { npx: [""], bunx: [""], pnpx: [""], pnpm: ["exec", "dlx"], npm: ["exec", "x"], yarn: ["exec", "dlx"], bun: ["x"] };

// The program a package runner would start, with its args, past the runner's own flags.
function innerCommand(name: string, args: string[]): string[] | undefined {
  const verbs = RUNS_NEXT[name];
  if (!verbs) return undefined;
  let rest = args;
  if (!verbs.includes("")) {
    if (!verbs.includes(rest[0] as string)) return undefined;
    rest = rest.slice(1);
  }
  while (rest[0]?.startsWith("-")) {
    const flag = rest[0];
    rest = rest.slice(1);
    if (flag === "--") break;
  }
  return rest.length ? rest : undefined;
}

// git's options before its subcommand that change what it runs: -c (core.pager, alias.*, core.sshCommand…),
// --config-env and --exec-path.
function gitRunsConfig(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (!a.startsWith("-")) return false;
    if (a === "-c" || /^-c./.test(a) || a.startsWith("--config-env") || a.startsWith("--exec-path")) return true;
    if (a === "-C") i++;
  }
  return false;
}

function refusal(name: string, args: string[]): string | undefined {
  if (SHELLS.has(name)) return `${name} runs a script the user can't see in the approval. Run the program itself, or put the steps in a package.json script.`;
  if (WRAPPERS.has(name)) return `${name} runs another command. Run that command directly.`;
  if (DUMPS.has(name)) return `${name} prints the environment, which would hold the secrets.`;
  if (NETWORK.has(name)) return `${name} sends data off the machine, so it doesn't get vault secrets.`;
  if (inlineCode(name, args)) return `${name} with inline code isn't allowed: put the code in a file or a package.json script, so the user sees what runs.`;
  if (name === "npm" && args[0] === "exec" && args.some((a) => a === "-c" || a.startsWith("--call"))) return "npm exec -c runs a shell string. Run the program directly.";
  if (name === "find" && args.some((a) => /^-(exec|execdir|ok|okdir)$/.test(a))) return "find -exec runs another command. Run that command directly.";
  if (name === "git" && gitRunsConfig(args)) return "git -c, --config-env and --exec-path can make git run another program (a pager, an alias, an ssh command).";
  const inner = innerCommand(name, args);
  return inner ? refusal(program(inner[0] as string), inner.slice(1)) : undefined;
}

/** Splits a command for main to run without a shell, or throws why it can't run with secrets. */
export function checkCommand(command: string, names: string[] = []): CheckedCommand {
  const line = command.trim();
  if (!line) throw new Error("Give a command to run.");
  const syntax = shellSyntax(line);
  if (syntax) {
    const what = syntax === "$" ? "$ (variables and $(…) aren't expanded: the program reads the secrets from its env)" : syntax === "'" || syntax === '"' ? "an unclosed quote" : `shell syntax (${JSON.stringify(syntax)})`;
    throw new Error(`The command has ${what}. It runs as one program with no shell: no pipes, redirects, ; or &&.`);
  }
  if (hasUnsafeText(line)) throw new Error("The command holds control or invisible characters (a bidi mark, a zero-width space): type it plainly so the approval shows what runs.");
  const words = parseShell(line).commands.flatMap((c) => c.words);
  const env: Record<string, string> = {};
  while (words.length && ASSIGNMENT.test(words[0] as string)) {
    const [, key, value] = ASSIGNMENT.exec(words.shift() as string) as RegExpExecArray;
    if (names.includes(key as string)) throw new Error(`${key} comes from the vault; don't set it on the command line.`);
    if (LOADER_VAR.test(key as string)) throw new Error(`${key} makes the program load code the approval doesn't show, so it can't be set here.`);
    env[key as string] = value as string;
  }
  const [first, ...args] = words;
  if (!first) throw new Error("The command only sets variables; give a program to run.");
  const why = refusal(program(first), args);
  if (why) throw new Error(why);
  return { argv: words, env };
}

/** Checks the names a thread asked for. */
export function checkNames(names: string[]): string[] {
  const unique = [...new Set(names)];
  if (!unique.length) throw new Error("Name at least one secret to put in the command's env.");
  const bad = unique.find((n) => !NAME.test(n));
  if (bad !== undefined) throw new Error(`${bad || "A blank name"} isn't a variable name.`);
  const loader = unique.find((n) => LOADER_VAR.test(n));
  if (loader !== undefined) throw new Error(`${loader} makes the program load code the approval doesn't show, so a vault value can't go in it.`);
  return unique;
}

// The package.json script a package runner would start, or undefined.
function scriptName(argv: string[]): string | undefined {
  const [bin, verb, next] = argv;
  const runner = SCRIPT_RUNNERS[program(bin as string)];
  if (!runner || !verb) return undefined;
  if (runner.run.includes(verb)) return next;
  if (runner.direct.includes(verb) || runner.direct.includes("*")) return verb;
  return undefined;
}

/**
 * What a package runner command would really run, from cwd's package.json, with its pre and post scripts:
 * the approval shows it, and a remembered approval lapses when it changes.
 */
export function packageScript(argv: string[], cwd: string): string | undefined {
  const name = scriptName(argv);
  if (!name) return undefined;
  let scripts: Record<string, unknown>;
  try {
    scripts = (JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, unknown> }).scripts ?? {};
  } catch {
    return undefined;
  }
  const lines = [`pre${name}`, name, `post${name}`].filter((s) => typeof scripts[s] === "string").map((s) => `${s}: ${scripts[s] as string}`);
  return lines.length ? lines.join("\n") : undefined;
}

/** cwd for a command, inside the project folder. */
export function resolveCwd(folder: string, cwd?: string): string {
  const resolved = path.resolve(folder, cwd ?? ".");
  const rel = path.relative(folder, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${cwd} is outside the project (${folder}).`);
  return resolved;
}
