// The worker's own clone of Weft (`~/.weft-worker/weft`) is the code the daemon and `weft-worker` run, through jiti, so
// an edit there takes effect on the next run: make lib/worker-repair.ts's check return null and the box re-pairs with
// no approval (docs/architecture/project-hosts.md#re-pairing-a-worker). A thread may read it and run its scripts
// (/weft:done runs commit.sh from the plugin inside it), never change it: only the updater (lib/worker-update.ts) does.
// Like the rest of the secret guard, it reads names on the line, so a program that builds the path at run time isn't seen.
import fs from "node:fs";
import path from "node:path";
import { home, type Step } from "./restart-guard";
import { workerHome } from "./worker-config";

export const workerClone = (h = workerHome()) => path.join(h, "weft");

// Commands that change the files they name.
const WRITERS = new Set("tee cp mv ln rsync install ditto rm rmdir unlink truncate dd touch chmod chown mkdir shred".split(" "));
// Writers whose target hides in an option or the cwd (`tar -C dir`, `unzip -d`, `curl -o`, `patch < x` run in the
// folder, `ed file`): any word, option value or the cwd itself landing in the clone counts.
const ANYWHERE = new Set("tar bsdtar unzip ditto curl wget patch ed ex".split(" "));
// Writers only with a flag: edit in place with -i (sed -i, perl -pi, ruby -i, awk -i inplace), or vim run as a script.
const editsInPlace = (a: string) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place");
const scriptsVim = (a: string) => /^-[a-zA-Z]*[esc]/.test(a) || a.startsWith("+");
const IN_PLACE = new Map<string, (a: string) => boolean>([
  ...["sed", "gsed", "perl", "ruby", "awk", "gawk"].map((n): [string, (a: string) => boolean] => [n, editsInPlace]),
  ...["vim", "vi", "nvim"].map((n): [string, (a: string) => boolean] => [n, scriptsVim]),
]);
// Copiers change only their destination, the last word or -t's: copying out of the clone is reading it.
const DEST_LAST = new Set(["cp", "rsync", "install", "ln"]);
const GIT_WRITES = new Set("apply checkout restore reset am stash pull merge rebase cherry-pick revert switch clean commit mv rm config worktree".split(" "));
// git's options that take the next word as their value.
const GIT_VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

const within = (file: string, dir: string) => {
  const rel = path.relative(dir, file);
  return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// Where a word lands as a path, from the step's cwd: `~`, `$HOME` and `${HOME}` spelled out, quotes, `of=` and an
// option's `--name=` dropped.
function landing(word: string, cwd: string): string {
  const bare = word.replace(/^(of=|--?[\w-]+=)/, "").replace(/^["']|["']$/g, "").replace(/^\$\{?HOME\}?(?=\/|$)/, "~");
  return path.resolve(cwd, home(bare));
}

function inClone(file: string, clone: string): boolean {
  if (within(file, clone)) return true;
  try {
    return within(fs.realpathSync(file), fs.realpathSync(clone));
  } catch {
    return false;
  }
}

// git's subcommand, past its own options and their values, and the folders those options point it at.
function gitParts(args: string[]): { sub: string; dirs: string[] } {
  const dirs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (GIT_VALUED.has(a)) {
      if (a !== "-c") dirs.push(args[i + 1] ?? ".");
      i++;
    } else if (/^--(git-dir|work-tree)=/.test(a)) dirs.push(a);
    else if (!a.startsWith("-")) return { sub: a, dirs };
  }
  return { sub: "", dirs };
}

// Whether a step changes a file in the clone: a writer naming one, or git run in it or pointed at it.
export function writesClone(step: Step, clone = workerClone()): boolean {
  const { name, args, cwd } = step;
  const at = (w: string) => inClone(landing(w, cwd), clone);
  if (name === "git") {
    const { sub, dirs } = gitParts(args);
    return GIT_WRITES.has(sub) && (dirs.length ? dirs : ["."]).some(at);
  }
  if (ANYWHERE.has(name)) return at(".") || args.some(at);
  const flag = IN_PLACE.get(name);
  if (flag ? !args.some(flag) : !WRITERS.has(name)) return false;
  const words = args.filter((a) => !a.startsWith("-"));
  const t = args.findIndex((a) => a === "-t" || a.startsWith("--target-directory"));
  const target = args[t] ?? "";
  if (DEST_LAST.has(name)) return (t >= 0 ? [target.includes("=") ? target : (args[t + 1] ?? "")] : words.slice(-1)).some(at);
  return words.some(at);
}

// The `> file` and `>> file` targets on a line (the step parser drops redirects), landing in the clone from the line's
// cwd or any folder a `cd` on it moves to. Quoted text is skipped, so `grep "a => b"` isn't a redirect.
export function redirectsIntoClone(command: string, cwd: string, clone = workerClone(), cwds: string[] = []): boolean {
  const bare = command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, " ");
  const targets = [...bare.matchAll(/(?:^|[^=\w-])>>?\|?\s*([^\s;&|<>()]+)/g)].map((m) => String(m[1]));
  return targets.some((t) => [cwd, ...cwds].some((c) => inClone(landing(t, c), clone)));
}

// Whether an Edit, Write or NotebookEdit of this file changes the clone.
export function editsClone(file: string, clone = workerClone()): boolean {
  return Boolean(file) && fs.existsSync(clone) && inClone(landing(file, process.cwd()), clone);
}

export const CLONE_REFUSAL =
  "Refused: ~/.weft-worker/weft is the worker's own copy of Weft, the code its daemon and weft-worker run. A thread may read it and run its scripts, not change it; the updater keeps it.";
