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
const WRITERS = new Set("tee cp mv ln rsync install ditto rm rmdir unlink truncate patch dd touch chmod chown mkdir shred".split(" "));
// Edit in place with -i (sed -i, perl -pi, ruby -i).
const IN_PLACE = new Set(["sed", "gsed", "perl", "ruby"]);
// Copiers change only their destination, the last word: copying out of the clone is reading it.
const DEST_LAST = new Set(["cp", "rsync", "install", "ditto", "ln"]);
const GIT_WRITES = new Set("apply checkout restore reset am stash pull merge rebase cherry-pick revert switch clean commit mv rm config".split(" "));

const within = (file: string, dir: string) => {
  const rel = path.relative(dir, file);
  return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// Where a word lands as a path, from the step's cwd: `~`, `$HOME` and `${HOME}` spelled out, quotes and `of=` dropped.
function landing(word: string, cwd: string): string {
  const bare = word.replace(/^of=/, "").replace(/^["']|["']$/g, "").replace(/^\$\{?HOME\}?(?=\/|$)/, "~");
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

function writes({ name, args }: Step): boolean {
  if (WRITERS.has(name)) return true;
  if (IN_PLACE.has(name)) return args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"));
  if (name === "git") return args.some((a) => GIT_WRITES.has(a));
  return false;
}

// Whether a step changes a file in the clone: a writer naming one, or git run in it or pointed at it with -C.
export function writesClone(step: Step, clone = workerClone()): boolean {
  if (!writes(step)) return false;
  const at = (w: string) => inClone(landing(w, step.cwd), clone);
  if (step.name === "git") {
    const c = step.args.indexOf("-C");
    return at(c >= 0 ? (step.args[c + 1] ?? ".") : ".");
  }
  const words = step.args.filter((a) => !a.startsWith("-"));
  return (DEST_LAST.has(step.name) ? words.slice(-1) : words).some(at);
}

// The `> file` and `>> file` targets on a line (the step parser drops redirects), landing in the clone.
export function redirectsIntoClone(command: string, cwd: string, clone = workerClone()): boolean {
  return [...command.matchAll(/>>?\|?\s*([^\s;&|<>()]+)/g)].some((m) => inClone(landing(String(m[1]), cwd), clone));
}

// Whether an Edit, Write or NotebookEdit of this file changes the clone.
export function editsClone(file: string, clone = workerClone()): boolean {
  return Boolean(file) && fs.existsSync(clone) && inClone(landing(file, process.cwd()), clone);
}

export const CLONE_REFUSAL =
  "Refused: ~/.weft-worker/weft is the worker's own copy of Weft, the code its daemon and weft-worker run. A thread may read it and run its scripts, not change it; the updater keeps it.";
