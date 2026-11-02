// Main's own check of a command that will run with vault values (electron/worker-secret.cjs), as defence in depth:
// lib/secret-command.ts checkCommand already turned it away on the asking side, but a Weft Worker's ask comes off the
// network, so main checks it again before the user is asked. The same rules, ported (main can't load .ts), and held
// to lib's by a parity test: one plain command, no shell syntax, no shells, wrappers, env dumps, network tools or
// inline code, and no control, format or bidi characters that would show the user something other than what runs.

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const META = new Set(["|", "&", ";", "<", ">", "(", ")", "`", "$", "\n", "\r"]);
// Control (Cc), format (Cf: zero-width and bidi controls) and line or paragraph separators.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const SHELLS = new Set("sh bash zsh dash ksh fish csh tcsh eval exec source . osascript".split(" "));
const WRAPPERS = new Set("env sudo doas xargs nohup time command builtin nice watch script parallel timeout stdbuf caffeinate".split(" "));
const DUMPS = new Set("printenv export set declare".split(" "));
const NETWORK = new Set("curl wget nc ncat netcat socat telnet ssh scp sftp ftp rsync http https xh aria2c".split(" "));
/** @type {Record<string, { short: string, long: string[] }>} */
const INLINE = {
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

/** The first character a shell would treat as syntax, outside quotes, or an unclosed quote. @param {string} command */
function shellSyntax(command) {
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === "\\") i++;
    else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "$" || c === "`") return c;
    } else if (c === "'" || c === '"') quote = c;
    else if (META.has(c)) return c;
  }
  return quote ?? undefined;
}

// One character inside double quotes: a backslash escapes only " or \. Returns how many characters it used.
function inDouble(line, i, push) {
  if (line[i] === "\\" && (line[i + 1] === '"' || line[i + 1] === "\\")) {
    push(line[i + 1]);
    return 2;
  }
  push(line[i]);
  return 1;
}

// Words as the shell would split a line with no syntax in it: quotes removed, a backslash escaping the next char
// (inside double quotes only before " or \).
/** @param {string} line */
function words(line) {
  const out = [];
  let word = "";
  let inWord = false;
  let quote = null;
  const push = (c) => (word += c);
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote && c === quote) quote = null;
    else if (quote === "'") word += c;
    else if (quote === '"') i += inDouble(line, i, push) - 1;
    else if (c === "\\") {
      word += line[++i] ?? "";
      inWord = true;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) out.push(word);
      word = "";
      inWord = false;
    } else {
      word += c;
      inWord = true;
    }
  }
  if (inWord) out.push(word);
  return out;
}

/** @param {string} word */
function program(word) {
  const base = word.split("/").pop() ?? word;
  return /^python\d*(\.\d+)?$/.test(base) ? "python" : base;
}

/** @param {string} name @param {string[]} args */
function inlineCode(name, args) {
  if (name === "awk" || name === "gawk") return true;
  const flags = INLINE[name];
  if (!flags) return false;
  for (const arg of args) {
    if (arg === "-") return true;
    if (flags.long.includes(arg.split("=")[0])) return true;
    if (/^-[A-Za-z]+$/.test(arg) && arg.slice(1).split("").some((c) => flags.short.includes(c))) return true;
    if (!arg.startsWith("-")) return false;
  }
  return false;
}

// Package runners that start another program: what they start is checked as a command of its own ("" = no verb).
/** @type {Record<string, string[]>} */
const RUNS_NEXT = { npx: [""], bunx: [""], pnpx: [""], pnpm: ["exec", "dlx"], npm: ["exec", "x"], yarn: ["exec", "dlx"], bun: ["x"] };

/** @param {string} name @param {string[]} args */
function innerCommand(name, args) {
  const verbs = RUNS_NEXT[name];
  if (!verbs) return undefined;
  let rest = args;
  if (!verbs.includes("")) {
    if (!verbs.includes(rest[0])) return undefined;
    rest = rest.slice(1);
  }
  while (rest[0]?.startsWith("-")) {
    const flag = rest[0];
    rest = rest.slice(1);
    if (flag === "--") break;
  }
  return rest.length ? rest : undefined;
}

// git's options before its subcommand that change what it runs.
/** @param {string[]} args */
function gitRunsConfig(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("-")) return false;
    if (a === "-c" || /^-c./.test(a) || a.startsWith("--config-env") || a.startsWith("--exec-path")) return true;
    if (a === "-C") i++;
  }
  return false;
}

/** @param {string} name @param {string[]} args @returns {string | undefined} */
function refusal(name, args) {
  if (SHELLS.has(name)) return `${name} runs a script the user can't see in the approval.`;
  if (WRAPPERS.has(name)) return `${name} runs another command.`;
  if (DUMPS.has(name)) return `${name} prints the environment, which would hold the secrets.`;
  if (NETWORK.has(name)) return `${name} sends data off the machine, so it doesn't get vault secrets.`;
  if (inlineCode(name, args)) return `${name} with inline code isn't allowed.`;
  if (name === "npm" && args[0] === "exec" && args.some((a) => a === "-c" || a.startsWith("--call"))) return "npm exec -c runs a shell string.";
  if (name === "find" && args.some((a) => /^-(exec|execdir|ok|okdir)$/.test(a))) return "find -exec runs another command.";
  if (name === "git" && gitRunsConfig(args)) return "git -c, --config-env and --exec-path can make git run another program.";
  const inner = innerCommand(name, args);
  return inner ? refusal(program(inner[0]), inner.slice(1)) : undefined;
}

/** Whether text holds a character that would show differently from what it is. @param {string} text */
const hasUnsafe = (text) => UNSAFE.test(text);

/**
 * The command's argv, or a throw saying why it can't run with secrets.
 * @param {string} command @param {string[]} [names] the vault names, which the line may not set itself
 * @returns {{ argv: string[], env: Record<string, string> }}
 */
function checkCommand(command, names = []) {
  const line = String(command).trim();
  if (!line) throw new Error("That command is empty.");
  if (hasUnsafe(line)) throw new Error("That command holds control or invisible characters.");
  if (shellSyntax(line)) throw new Error("That command has shell syntax; it runs as one program with no shell.");
  const all = words(line);
  const env = {};
  while (all.length && ASSIGNMENT.test(all[0])) {
    const [, key, value] = /** @type {RegExpExecArray} */ (ASSIGNMENT.exec(/** @type {string} */ (all.shift())));
    if (names.includes(key)) throw new Error(`${key} comes from the vault; the command can't set it.`);
    env[key] = value;
  }
  const [first, ...args] = all;
  if (!first) throw new Error("That command only sets variables.");
  const why = refusal(program(first), args);
  if (why) throw new Error(why);
  return { argv: all, env };
}

module.exports = { checkCommand, hasUnsafe, words, shellSyntax };
