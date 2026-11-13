// Updates in dev mode: Weft run from its own checkout (`pnpm desktop`, ~/Applications/Weft.app) updates by following
// origin/main, not GitHub Releases. Check fetches main and counts the commits this checkout lacks; Update Now
// fast-forwards to them (never a merge, a rebase or a stash: other cards' uncommitted work lives in this tree, and git
// itself refuses a fast-forward that would overwrite it), runs pnpm install when the lockfile moved, and asks for a
// restart when Electron's own code or the version changed, since `next dev` reloads everything else on its own.
// withDevUpdates wraps the release updater (updater.cjs) so the menu, the Software Update window and its view
// (update-view.cjs) work unchanged. docs/architecture/updates.md#dev-mode.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { compareVersions } = require("./updater.cjs");
const { mergeOverDirty, refusedFiles } = require("./dev-update-merge.cjs");

const BRANCH = "main";
const GIT_MS = 60_000;
const INSTALL_MS = 10 * 60_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 30_000;
const NOTES_MAX = 30;
// Where pnpm lives when Weft was opened from the Dock, whose PATH is launchd's bare one.
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", path.join(process.env.HOME || "", "Library/pnpm")];

function runCommand(cmd, args, { cwd, timeoutMs }) {
  const env = { ...process.env, PATH: [process.env.PATH, ...EXTRA_PATH].filter(Boolean).join(path.delimiter) };
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, env, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr).trim() || err.message));
      else resolve(String(stdout));
    });
  });
}

const short = (sha) => String(sha).slice(0, 7);
const firstLines = (err, n = 3) => String(err?.message || err).split("\n").slice(0, n).join(" ").trim();

// The git side, over an injectable `run` so tests never touch a real checkout. `backupRoot` is where working copies
// go before a merge over dirty files (dev-update-merge.cjs); `cardsEditing(files)` names the cards that edited them.
function devGit({ dir, run = runCommand, readFile = (f) => fs.readFileSync(f, "utf8"), backupRoot = null, cardsEditing }) {
  const git = async (args) => (await run("git", args, { cwd: dir, timeoutMs: GIT_MS })).trim();
  const head = () => git(["rev-parse", "HEAD"]);
  const count = async (range) => Number(await git(["rev-list", "--count", range])) || 0;
  const changed = async (from, to) => (from === to ? [] : (await git(["diff", "--name-only", from, to])).split("\n").filter(Boolean));

  function diskVersion() {
    try {
      return JSON.parse(readFile(path.join(dir, "package.json"))).version || null;
    } catch {
      return null;
    }
  }

  // What origin/main has that this checkout doesn't. Throws a plain sentence when the checkout can't follow it.
  async function survey() {
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== BRANCH) throw new Error(`This checkout is on ${branch}, not ${BRANCH}, so it isn't updated from GitHub.`);
    await git(["fetch", "origin", BRANCH]);
    const from = await head();
    const target = await git(["rev-parse", "FETCH_HEAD"]);
    const behind = from === target ? 0 : await count(`${from}..${target}`);
    const ahead = from === target ? 0 : await count(`${target}..${from}`);
    const notes = behind ? await git(["log", "--format=- %s", `-${NOTES_MAX}`, `${from}..${target}`]) : "";
    return { from, target, behind, ahead, notes };
  }

  // Fast-forwards to `target`, then installs when the lockfile moved. Resolves to the files that changed.
  async function pull(from, target) {
    try {
      await git(["merge", "--ff-only", target]);
    } catch (err) {
      // Refused only over other cards' dirty files: merge them in place when every one merges cleanly.
      const dirty = backupRoot && refusedFiles(err?.message);
      if (!dirty) throw new Error(`git couldn't fast-forward: ${firstLines(err)}`);
      try {
        await mergeOverDirty({ dir, run, target, files: dirty, backupRoot, cardsEditing });
      } catch (merr) {
        if (/Commit those cards/.test(merr?.message)) throw merr;
        throw new Error(`git couldn't fast-forward: ${firstLines(merr)}`);
      }
    }
    const files = await changed(from, target);
    if (files.some((f) => f === "pnpm-lock.yaml" || f === "package.json")) {
      try {
        await run("pnpm", ["install", "--frozen-lockfile"], { cwd: dir, timeoutMs: INSTALL_MS });
      } catch (err) {
        throw new Error(`Pulled ${short(target)}, but pnpm install failed: ${firstLines(err)} Run pnpm install in ${dir}.`);
      }
    }
    return files;
  }

  return { survey, pull, head, changed, diskVersion };
}

// Electron main and its preloads load once, at launch: a change there, or a new version, needs a restart.
const needsRestart = (files) => files.some((f) => f.startsWith("electron/") || f === "package.json");

function withDevUpdates(base, { git, currentVersion, relaunch, onChange = () => {}, openWindow = null, log = console }) {
  let state = { phase: "idle" };
  let timer = null;
  // The commit Electron launched on, so a pull can tell whether what it brought needs a restart.
  const launched = git.head().catch(() => null);

  function set(next) {
    state = next;
    onChange(state);
  }

  // A pull (this one, or a git pull in a terminal) left code Electron hasn't loaded yet.
  async function pendingRestart() {
    const disk = git.diskVersion();
    if (disk && compareVersions(disk, currentVersion) !== 0) return true;
    const from = await launched;
    return Boolean(from) && needsRestart(await git.changed(from, await git.head()));
  }

  async function check() {
    if (["checking", "pulling"].includes(state.phase)) return state;
    const before = state;
    set({ phase: "checking" });
    try {
      const s = await git.survey();
      const checkedAt = Date.now();
      const version = git.diskVersion();
      if (s.behind > 0 && s.ahead > 0) {
        const error = `This checkout has ${s.ahead} commit${s.ahead === 1 ? "" : "s"} origin/main doesn't. Push or rebase them, then update.`;
        set({ phase: "idle", error, checkedAt });
      } else if (s.behind > 0) set({ phase: "available", commits: s.behind, target: short(s.target), full: s.target, from: s.from, notes: s.notes, checkedAt });
      else if (await pendingRestart()) set({ phase: "ready", version, target: short(s.from), checkedAt });
      else set({ phase: "idle", upToDate: true, target: short(s.from), checkedAt });
    } catch (err) {
      set(before.phase === "available" ? before : { phase: "idle", error: firstLines(err), checkedAt: Date.now() });
    }
    return state;
  }

  async function pull() {
    if (state.phase !== "available") return state;
    const { from, full, commits, notes, target } = state;
    set({ ...state, phase: "pulling" });
    try {
      const files = await git.pull(from, full);
      const done = { commits, notes, target, pulled: commits, checkedAt: Date.now() };
      if (needsRestart(files) || (await pendingRestart())) set({ ...done, phase: "ready", version: git.diskVersion() });
      else set({ ...done, phase: "idle", upToDate: true });
    } catch (err) {
      log.warn?.(`Weft dev update: ${err.message}`);
      set({ phase: "idle", error: firstLines(err, 4), checkedAt: Date.now() });
    }
    return state;
  }

  // Restart when idle: right away when nothing runs, otherwise once the running threads finish.
  async function install() {
    if (state.phase !== "ready") return false;
    await relaunch();
    return true;
  }

  function menuItem() {
    const label =
      state.phase === "ready" ? "Restart to Update…" : state.phase === "available" ? `Update Weft (${state.commits} new)…` : "Check for Updates…";
    return {
      label,
      click: () => {
        openWindow?.();
        if (state.phase === "idle") check().catch(() => {});
      },
    };
  }

  function start() {
    base.start();
    if (timer) return;
    timer = setTimeout(function tick() {
      check().catch(() => {});
      timer = setTimeout(tick, CHECK_EVERY_MS);
    }, FIRST_CHECK_MS);
  }

  function stop() {
    base.stop();
    clearTimeout(timer);
    timer = null;
  }

  return {
    ...base,
    check,
    pull,
    install,
    installNow: () => false, // restartFor relaunches when this declines, which is the dev update's restart
    download: () => pull(),
    menuItem,
    start,
    stop,
    state: () => state,
    info: () => ({ ...base.info(), state, dev: true }),
  };
}

module.exports = { devGit, withDevUpdates, needsRestart, runCommand, BRANCH };
