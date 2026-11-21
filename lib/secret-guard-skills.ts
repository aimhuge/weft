// The CLI's installed skills, `~/.claude/skills/<name>/` (and CLAUDE_CONFIG_DIR's, and a plugin's `skills/` under
// `~/.claude/plugins/`), open to read and to run. The seal on the CLI's home covered them too, so the Skill tool loaded
// a SKILL.md (the CLI reads it, not a hook) but every script, reference and template it ships was refused: Anthropic's
// pptx skill says `python ~/.claude/skills/pptx/scripts/office/validate.py deck.pptx`, and the guard turned it away
// (2026-11-21, worker m1mini). Every skills.sh skill with scripts was broken in Weft threads.
//
// Writes stay sealed: a skill is loaded by every later thread, so one a thread could change would plant instructions in
// all of them. Read, Grep, Glob and LS open (lib/secret-guard-tool.ts); Write and Edit still meet the seal. In Bash,
// `withoutSkills` swaps a skill's paths for stand-ins only on a line that just reads or runs them (`readsOnly`); a line
// that names one any other way (`rm`, `mv`, `> file`, `cp x <skill>`, a path inside `-c` code) reaches the seal as it was.

import fs from "node:fs";
import path from "node:path";
import { cliHomes, inCliHome } from "./secret-guard-cli-home";
import { parseShell } from "./shell-parse";
import { stripPrefixes, unwrapEnv } from "./secret-guard-bash";

// Where a path really lands, links followed; one that isn't there yet (a glob, a typo) stands for itself.
function real(at: string): string {
  try {
    return fs.realpathSync(at);
  } catch {
    return at;
  }
}

// macOS folds case, so `~/.CLAUDE/Skills` is the same folder.
const under = (at: string, dir: string) => {
  const rel = path.relative(dir.toLowerCase(), at.toLowerCase());
  return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// The skills folders in each of the CLI's homes, where they're named and where they really are.
export function skillsDirs(): string[] {
  return [...new Set(cliHomes(real).flatMap((home) => [path.join(home, "skills"), real(path.join(home, "skills"))]))];
}

// A plugin's own skills: `~/.claude/plugins/<…>/skills/…`. The rest of a plugin (its hooks) stays sealed.
function inPluginSkills(at: string): boolean {
  return cliHomes(real).some((home) => {
    const plugins = path.join(home, "plugins");
    return under(at, plugins) && path.relative(plugins.toLowerCase(), at.toLowerCase()).split("/").includes("skills");
  });
}

const namedSkill = (at: string) => skillsDirs().some((d) => under(at, d)) || inPluginSkills(at);

// Whether an absolute path (home and the card's cwd already placed) is in an installed skill, both where it's named and
// where it really lands: a link in a skill to `~/.claude/settings.json` or a transcript stays sealed. A link out of the
// CLI's home altogether is judged where it lands (`skillStandIn`). A `..` anywhere is refused before it's folded.
export function inSkills(at: string): boolean {
  if (!at || /(?:^|\/)\.\.(?:\/|$)/.test(at) || !namedSkill(at)) return false;
  const landed = real(at);
  return namedSkill(landed) || !inCliHome(landed, real);
}

// What the rest of the guard judges in a skill's path's place: its real place when that's outside the CLI's home (so a
// link to a `.env` is still a `.env`), otherwise a stand-in outside `~/.claude` with the same name. Undefined when the
// path isn't in a skill.
export function skillStandIn(at: string): string | undefined {
  if (!inSkills(at)) return undefined;
  const landed = real(at);
  return inCliHome(landed, real) ? path.join("/tmp/weft-skill", path.basename(at)) : landed;
}

// Commands that only read what they're named: any argument may be a skill's file or folder.
const READ_ONLY = new Set(
  ("cat bat less more head tail nl grep egrep fgrep rg wc file stat ls find diff cmp jq strings od cut readlink realpath " +
    "dirname basename md5 md5sum shasum sha1sum sha256sum").split(" "),
);
// find's options that run, delete or write.
const FIND_WRITES = /^-(exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/;
// Run a script: a skill's file may be the script, never an argument after it.
const RUNNERS = new Set("python python3 node bash sh zsh ruby perl bun tsx ts-node".split(" "));
// Copy out of a skill: a source may be a skill's path, never the destination.
const COPIERS = new Set(["cp", "ditto"]);

// A path in a shell command that may be in a skill: `~/.claude/skills/pptx/scripts/office/validate.py`.
const SKILL_PATH = /(?:~|\$\{?HOME\}?|\/)[^\s'"`;|&<>()]*\/(?:skills|plugins)(?:\/[^\s'"`;|&<>()]*)?/gi;

// Whether one command's words use the skill paths (`is`) only to read or run them.
function wordsRead(words: string[], is: (w: string) => boolean, has: (w: string) => boolean): boolean {
  const run = unwrapEnv(stripPrefixes(words));
  const at = run.flatMap((w, i) => (has(w) ? [i] : []));
  if (!at.length) return true;
  // A skill's path inside a bigger word (`-c "…"`, `--out=…`) is code or an option, not a file being read.
  if (at.some((i) => !is(run[i] ?? ""))) return false;
  const cmd = path.basename(run[0] ?? "");
  const args = at.map((i) => i - 1);
  // `~/.claude/skills/x/run.sh deck.pptx`: running the skill's own script, its arguments elsewhere.
  if (at[0] === 0) return at.length === 1;
  if (READ_ONLY.has(cmd)) return cmd !== "find" || !run.some((w) => FIND_WRITES.test(w));
  if (RUNNERS.has(cmd)) return args.length === 1 && args[0] === run.slice(1).findIndex((w) => !w.startsWith("-"));
  if (COPIERS.has(cmd)) return !run.some((w) => /^(-t|--target-directory)/.test(w)) && !at.includes(run.length - 1);
  return false;
}

// Whether a line uses the skill paths only to read or run them: no redirect into one, and every nested `$( … )` too.
export function readsOnly(command: string, is: (w: string) => boolean, has: (w: string) => boolean, depth = 0): boolean {
  if (depth > 5) return false;
  const { commands, nested } = parseShell(command);
  return (
    commands.every((c) => !c.outputs.some(has) && wordsRead(c.words, is, has)) && nested.every((n) => readsOnly(n, is, has, depth + 1))
  );
}

// The command with each skill path swapped for what the guard should judge (`skillStandIn`), when the line only reads or
// runs them; otherwise as it was, so the seal on the CLI's home refuses it.
export function withoutSkills(command: string, place: (file: string) => string): string {
  if (!/\/(?:skills|plugins)\b/i.test(command)) return command;
  const found = new Map<string, string>();
  for (const [p] of command.matchAll(SKILL_PATH)) {
    const standIn = found.has(p) ? undefined : skillStandIn(place(p));
    if (standIn) found.set(p, standIn);
  }
  if (!found.size) return command;
  const paths = [...found.keys()];
  const has = (w: string) => paths.some((p) => w.includes(p));
  if (!readsOnly(command, (w) => found.has(w), has)) return command;
  return command.replace(SKILL_PATH, (p) => found.get(p) ?? p);
}
