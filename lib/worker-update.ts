// A Weft Worker keeps itself current (docs/architecture/weft-worker.md#auto-updates). When main is pushed, or on the
// slow check, it fetches main into its clone (lib/worker-update-loop.ts decides when). When there's a newer commit and no card is live, it fast-forwards, installs, and loads the whole
// engine in a child process. Only then does it exit, and the service brings it back on the new code. A commit that
// won't load is put back and skipped from then on. A commit that loads and then dies at start can't undo itself, so
// the service wrapper does that from outside the clone (install/worker-rollback.sh), counting the starts in
// update-trial until the daemon says it's healthy.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const UPDATE_EVERY_MS = 15 * 60_000;
// A daemon that has run this long and reached the database isn't the crash the wrapper is watching for.
export const HEALTHY_AFTER_MS = 60_000;
const GIT_MS = 60_000;
const INSTALL_MS = 10 * 60_000;
const CHECK_MS = 3 * 60_000;
const BRANCH = "main";
const NOTE_MAX = 300;
const OUTPUT_MAX = 1024 * 1024;

export type Run = (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<string>;

export interface Tick {
  // Exit now: the new code is in place and proved it loads.
  restart: boolean;
  // Why this worker isn't on the newest commit, for its row. Null when it is, or when it has just moved.
  note: string | null;
  // The commit a live card is holding back, short: the loop names the cards and tries again when they finish.
  held?: string;
}

export type Updater = ReturnType<typeof createUpdater>;

type Survey = { kind: "current" } | { kind: "blocked"; note: string } | { kind: "ready"; from: string; target: string };

export const runCommand: Run = (cmd, args, { cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: OUTPUT_MAX }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message, { cause: err }));
      else resolve(stdout);
    });
  });

// Only the clone install/worker.sh made: a daemon started from a developer's own checkout must leave that checkout alone.
export function updatesOn(home: string, dir: string, env: NodeJS.ProcessEnv = process.env) {
  return env.WEFT_WORKER_AUTO_UPDATE !== "0" && path.resolve(dir) === path.join(path.resolve(home), "weft");
}

const short = (sha: string) => sha.slice(0, 7);
const firstLine = (err: unknown) => (err as Error).message.split("\n")[0]?.slice(0, NOTE_MAX) ?? "";

export function createUpdater({ home, dir, run = runCommand, log = console.log }: { home: string; dir: string; run?: Run; log?: (msg: string) => void }) {
  const trialFile = path.join(home, "update-trial");
  const startsFile = path.join(home, "update-trial.starts");
  const badFile = path.join(home, "update-bad");
  const git = (args: string[]) => run("git", args, { cwd: dir, timeoutMs: GIT_MS });
  const install = () => run("pnpm", ["install", "--frozen-lockfile", "--config.confirmModulesPurge=false"], { cwd: dir, timeoutMs: INSTALL_MS });
  const head = async () => (await git(["rev-parse", "HEAD"])).trim();

  // The commits that failed here: "<sha> <why>", one a line. The wrapper appends to this file too.
  function whyBad(sha: string): string | null {
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(badFile, "utf8").split("\n");
    } catch {
      return null;
    }
    const line = lines.find((l) => l.startsWith(`${sha} `));
    return line ? line.slice(sha.length + 1) : null;
  }

  async function isAncestor(sha: string, of: string) {
    try {
      await git(["merge-base", "--is-ancestor", sha, of]);
      return true;
    } catch {
      return false;
    }
  }

  async function survey(): Promise<Survey> {
    const from = await head();
    await git(["fetch", "origin", BRANCH]);
    const target = (await git(["rev-parse", "FETCH_HEAD"])).trim();
    if (target === from) return { kind: "current" };
    const bad = whyBad(target);
    if (bad) return { kind: "blocked", note: `Skipping ${short(target)}: ${bad}` };
    if ((await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim() !== BRANCH) return { kind: "blocked", note: `Not updating: the clone isn't on ${BRANCH}.` };
    if ((await git(["status", "--porcelain"])).trim()) return { kind: "blocked", note: "Not updating: the clone has local changes." };
    if (!(await isAncestor(from, target))) return { kind: "blocked", note: `Not updating: the clone has moved past ${BRANCH}.` };
    return { kind: "ready", from, target };
  }

  function clearTrial() {
    fs.rmSync(trialFile, { force: true });
    fs.rmSync(startsFile, { force: true });
  }

  async function putBack(from: string) {
    try {
      await git(["reset", "--hard", from]);
      await install();
    } catch (err) {
      log(`Weft Worker: couldn't go back to ${short(from)}: ${(err as Error).message}`);
    }
    clearTrial();
  }

  async function apply(from: string, target: string): Promise<Tick> {
    log(`Weft Worker: updating ${short(from)} → ${short(target)}`);
    // Written first, so a daemon that dies part way through is already on trial.
    fs.writeFileSync(trialFile, `${from}\n${target}\n`, { mode: 0o600 });
    try {
      await git(["merge", "--ff-only", target]);
      await install();
    } catch (err) {
      // Most likely the network, so the next check tries the same commit again.
      await putBack(from);
      return { restart: false, note: `Stayed on ${short(from)}: installing ${short(target)} failed. ${firstLine(err)}` };
    }
    try {
      await run(process.execPath, ["node_modules/jiti/lib/jiti-cli.mjs", "scripts/weft-worker.ts", "check"], { cwd: dir, timeoutMs: CHECK_MS });
    } catch (err) {
      const why = `it doesn't load. ${firstLine(err)}`;
      await putBack(from);
      fs.appendFileSync(badFile, `${target} ${why}\n`, { mode: 0o600 });
      log(`Weft Worker: ${short(target)} ${why}`);
      return { restart: false, note: `Skipping ${short(target)}: ${why}` };
    }
    fs.copyFileSync(path.join(dir, "install", "worker-rollback.sh"), path.join(home, "rollback.sh"));
    log(`Weft Worker: on ${short(target)}; restarting into it.`);
    return { restart: true, note: null };
  }

  return {
    // `hold` says the worker is idle and stops it taking work; called only when there's something to apply.
    async tick(hold: () => boolean): Promise<Tick> {
      const plan = await survey();
      if (plan.kind === "current") return { restart: false, note: null };
      if (plan.kind === "blocked") return { restart: false, note: plan.note };
      if (!hold()) return { restart: false, note: null, held: short(plan.target) };
      return apply(plan.from, plan.target);
    },
    // What this box runs, as the Software Update window writes it: 0.6.7+abc1234.
    async build() {
      const { version } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { version: string };
      return `${version}+${short(await head())}`;
    },
    // The new code stayed up, so the wrapper stops counting.
    healthy: clearTrial,
  };
}
