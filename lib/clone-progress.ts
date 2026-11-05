// A GitHub clone with progress: `gh repo clone` passes `--progress` on to git, whose stderr redraws lines like
// "Receiving objects:  45% (555/1234), 1.2 MiB | 2.3 MiB/s" with \r. Each line becomes one overall percent
// (the phases weighted by how long they usually take) kept in memory per repo while the clone runs, so the
// repo picker and the project menu can poll GET /api/repos/clone?fullName= and draw a bar instead of a spinner.
import { spawn } from "node:child_process";
import { globalSingleton } from "./global-singleton";
import type { CloneJob } from "./clone-progress-types";

// The shape of a clone's progress lives in lib/clone-progress-types.ts (types only, no node:child_process),
// so the board can name it without dragging this module into the browser chunk. Re-exported here: the
// server's own imports of "./clone-progress" keep working.
export type { CloneJob };

const TIMEOUT_MS = 10 * 60_000;

// Where each git phase sits on the overall bar: [start, end] in percent.
const PHASES: [RegExp, number, number, string][] = [
  [/^(?:remote: )?Enumerating objects/, 0, 2, "Counting objects"],
  [/^(?:remote: )?Counting objects/, 2, 6, "Counting objects"],
  [/^(?:remote: )?Compressing objects/, 6, 10, "Compressing objects"],
  [/^Receiving objects/, 10, 80, "Receiving objects"],
  [/^Resolving deltas/, 80, 95, "Resolving deltas"],
  [/^(?:Updating|Checking out) files/, 95, 100, "Checking out files"],
];

// One progress line as an overall percent and a short label ("Receiving objects · 1.2 MiB | 2.3 MiB/s"), or
// null for anything else (gh's "Cloning into…", an error).
export function parseCloneLine(line: string): { percent: number; line: string } | null {
  const phase = PHASES.find(([re]) => re.test(line));
  if (!phase) return null;
  const [, start, end, label] = phase;
  const pct = /(\d{1,3})%/.exec(line);
  const within = pct ? Math.min(100, Number(pct[1])) : 0;
  const rate = /,\s*([\d.]+ [KMG]?i?B \| [\d.]+ [KMG]?i?B\/s)/.exec(line)?.[1];
  return { percent: Math.round(start + ((end - start) * within) / 100), line: rate ? `${label} · ${rate}` : label };
}

const jobs = () => globalSingleton("weft-clone-jobs", () => new Map<string, CloneJob>());
const key = (fullName: string) => fullName.toLowerCase();

// The clone of owner/name running or last finished here, or null.
export function cloneProgress(fullName: string): CloneJob | null {
  const job = jobs().get(key(fullName));
  return job ? { ...job } : null;
}

// Clones owner/name into target through gh, updating its job as git reports progress. A failure rejects with
// the last thing gh or git said that wasn't a progress line, which names the problem.
export function runClone(fullName: string, target: string): Promise<void> {
  const job: CloneJob = { status: "running", line: "Starting…", percent: 0 };
  jobs().set(key(fullName), job);
  return new Promise<void>((resolve, reject) => {
    const child = spawn("gh", ["repo", "clone", fullName, target, "--", "--progress"], { timeout: TIMEOUT_MS });
    let said = "";
    let partial = "";
    const take = (chunk: Buffer) => {
      const lines = (partial + chunk.toString("utf8")).split(/[\r\n]/);
      partial = String(lines.pop());
      for (const raw of lines) {
        const text = raw.trim();
        if (!text) continue;
        const progress = parseCloneLine(text);
        if (progress) Object.assign(job, progress);
        else said = text;
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (partial.trim() && !parseCloneLine(partial.trim())) said = partial.trim();
      if (code === 0) resolve();
      else reject(new Error(signal ? `timed out after ${TIMEOUT_MS / 60_000} minutes` : said || `gh exited with ${code}`));
    });
  }).then(
    () => {
      Object.assign(job, { status: "done", line: "Cloned", percent: 100 });
    },
    (err: unknown) => {
      Object.assign(job, { status: "failed", line: err instanceof Error ? err.message : String(err) });
      throw err;
    },
  );
}
