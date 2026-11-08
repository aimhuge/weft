// The words a command takes as text, not as a path it opens: a commit message, a pull request's title and body,
// release notes, a sentence echo prints. The secret guard and the folder gate read every word on the line, so
// `gh pr create --body "… ~/.weft/vault/ …"` was refused for a body that only mentioned the vault, and a page written
// with `cat > plan.md <<EOF` asked about every folder it named (2026-11-02). A `$(…)` inside the text still runs:
// the parser hands it back as a nested command, and both guards check that on its own.

import path from "node:path";
import { parseShell, type SimpleCommand } from "./shell-parse";

const TEXT_FLAG = "message|body|title|notes|subject|description|comment|summary";
// `--body text` and `--body=text`, for the commands below only: elsewhere `--summary` may be a switch, and the word
// after it a file.
const LONG = new RegExp(`^--(${TEXT_FLAG})$`);
const LONG_JOINED = new RegExp(`^--(${TEXT_FLAG})=`);
// The short forms, per command: `git commit -am "msg"`, `gh pr create -t title -b body`, `glab mr create -d text`.
const SHORT: Record<string, RegExp> = { git: /^-[a-zA-Z]*m$/, gh: /^-[mtbn]$/, glab: /^-[mtd]$/, hub: /^-m$/, jj: /^-m$/, hg: /^-m$/ };
// git's -m is a message only here: `git revert -m 1` names a parent, `git branch -m` renames.
const GIT_MESSAGE = new Set(["commit", "tag", "notes", "merge", "stash"]);
// git's options before the subcommand that take a value: `git -C commit diff -m x` runs diff, not commit.
const GIT_VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--exec-path"]);
// echo and printf print their words; a word with a space in it was quoted, so the shell globs none of it.
const PRINTERS = new Set(["echo", "printf"]);
// An agent CLI's prompt or a tool's message, on any command: `puku-cli -p "…"`, `claude --prompt="…"`, `llm -m …`. Only
// a sentence counts (a space in it, not starting like a path), so `mkdir -p "/Users/me/My Drive/x"` and `ssh -p 22` stay
// words; a long prompt saying "-- and /* */ comments" read as a root glob and asked about /Volumes (2026-11-08).
const PROMPT_FLAG = /^(?:-p|-m|--prompt|--message)$/;
const PROMPT_JOINED = /^--(?:prompt|message)=([^]*)$/;
const sentence = (w: string) => /\s/.test(w) && !/^(?:~|\$HOME|\$\{HOME\}|\.{0,2}\/)/.test(w);
function promptWords(words: string[], text: Set<number>) {
  for (let i = 1; i < words.length; i++) {
    const w = words[i] as string;
    if (sentence(PROMPT_JOINED.exec(w)?.[1] ?? "")) text.add(i);
    else if (PROMPT_FLAG.test(w) && sentence(words[i + 1] ?? "")) text.add(++i);
  }
}
// These run their words as code or as a command of their own, so a heredoc fed to one may be code.
export const RUNS_CODE = new Set(
  "sh bash zsh dash ksh fish eval python python3 node ruby perl php deno bun tsx ts-node osascript xargs find npx bunx pnpx dlx pnpm npm yarn env sudo".split(" "),
);

// git's subcommand: the first word past its own options and their values.
export function gitSubcommand(words: string[]): string | undefined {
  for (let i = 1; i < words.length; i++) {
    const w = words[i] as string;
    if (GIT_VALUED.has(w)) i++;
    else if (!w.startsWith("-")) return w;
  }
  return undefined;
}

// Whether a command's text flags are text: git's only for a subcommand that takes a message.
const takesText = (cmd: string, words: string[]) => cmd !== "git" || GIT_MESSAGE.has(gitSubcommand(words) ?? "");

// The indexes of words (a command's own, prefixes stripped) that are text.
export function textWords(words: string[]): Set<number> {
  const cmd = path.basename(words[0] ?? "");
  const text = new Set<number>();
  const short = SHORT[cmd] ?? /$^/;
  promptWords(words, text);
  if (!PRINTERS.has(cmd) && !(cmd in SHORT && takesText(cmd, words))) return text;
  for (let i = 1; i < words.length; i++) {
    const w = words[i] as string;
    if (PRINTERS.has(cmd)) {
      if (/\s/.test(w)) text.add(i);
    } else if (LONG_JOINED.test(w)) text.add(i);
    else if ((LONG.test(w) || short.test(w)) && i + 1 < words.length) text.add(++i);
  }
  return text;
}

// What a heredoc or here-string feeds a command that doesn't run it: `cat > page.md <<EOF` writes text. Fed to a
// shell or an interpreter, or piped on (`cat <<EOF | sh`), it may be code.
const proseStdin = (c: SimpleCommand) => (c.pipes || RUNS_CODE.has(path.basename(c.words[0] ?? "")) ? [] : c.stdin);

// The prose on a command line: its commands' text words and the heredocs they write, not those of its nested `$(…)`
// commands, which the caller reads as commands of their own.
export function proseOf(command: string): { prose: string[]; nested: string[] } {
  const { commands, nested } = parseShell(command);
  const prose = commands.flatMap((c) => {
    const at = c.words.findIndex((w) => !/^[A-Za-z_]\w*=/.test(w));
    const own = at < 0 ? [] : c.words.slice(at);
    const text = textWords(own);
    return [...own.filter((_, i) => text.has(i)), ...proseStdin(c)];
  });
  return { prose, nested };
}
