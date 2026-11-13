import { describe, expect, it, vi } from "vitest";
import { devGit, needsRestart, withDevUpdates } from "./dev-update.cjs";

const A = "a".repeat(40);
const B = "b".repeat(40);

// A fake `git`/`pnpm`: answers by the first args, records every call.
function fakeRun(answers: Record<string, string | Error>) {
  const calls: string[] = [];
  const run = vi.fn((cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(" ")}`;
    calls.push(key);
    const hit = Object.keys(answers).find((k) => key.startsWith(k));
    const out = hit === undefined ? "" : (answers[hit] ?? "");
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
  });
  return { run, calls };
}

const base = () => ({ start: vi.fn(), stop: vi.fn(), info: () => ({ currentVersion: "0.8.0", packaged: false }), countRunning: vi.fn() });

describe("devGit", () => {
  it("surveys main: behind, ahead and the new commits' subjects", async () => {
    const { run, calls } = fakeRun({
      "git rev-parse --abbrev-ref HEAD": "main\n",
      "git rev-parse HEAD": A,
      "git rev-parse FETCH_HEAD": B,
      [`git rev-list --count ${A}..${B}`]: "2",
      [`git rev-list --count ${B}..${A}`]: "0",
      "git log": "- feat: one\n- fix: two",
    });
    const s = await devGit({ dir: "/w", run }).survey();
    expect(s).toEqual({ from: A, target: B, behind: 2, ahead: 0, notes: "- feat: one\n- fix: two" });
    expect(calls).toContain("git fetch origin main");
  });

  it("is current when FETCH_HEAD is HEAD", async () => {
    const { run } = fakeRun({ "git rev-parse --abbrev-ref HEAD": "main", "git rev-parse HEAD": A, "git rev-parse FETCH_HEAD": A });
    expect(await devGit({ dir: "/w", run }).survey()).toMatchObject({ behind: 0, ahead: 0, notes: "" });
  });

  it("refuses a checkout on another branch", async () => {
    const { run } = fakeRun({ "git rev-parse --abbrev-ref HEAD": "feature" });
    await expect(devGit({ dir: "/w", run }).survey()).rejects.toThrow(/on feature, not main/);
  });

  it("pulls with a fast-forward, installing only when the lockfile moved", async () => {
    const lock = fakeRun({ "git diff --name-only": "pnpm-lock.yaml\nlib/x.ts" });
    expect(await devGit({ dir: "/w", run: lock.run }).pull(A, B)).toEqual(["pnpm-lock.yaml", "lib/x.ts"]);
    expect(lock.calls).toEqual([`git merge --ff-only ${B}`, `git diff --name-only ${A} ${B}`, "pnpm install --frozen-lockfile"]);
    const plain = fakeRun({ "git diff --name-only": "lib/x.ts" });
    await devGit({ dir: "/w", run: plain.run }).pull(A, B);
    expect(plain.calls).not.toContain("pnpm install --frozen-lockfile");
  });

  it("says why a fast-forward or an install failed", async () => {
    const ff = fakeRun({ "git merge": new Error("error: Your local changes would be overwritten") });
    await expect(devGit({ dir: "/w", run: ff.run }).pull(A, B)).rejects.toThrow(/couldn't fast-forward: error: Your local changes/);
    const inst = fakeRun({ "git diff": "package.json", pnpm: new Error("ERR_PNPM") });
    await expect(devGit({ dir: "/w", run: inst.run }).pull(A, B)).rejects.toThrow(/pnpm install failed: ERR_PNPM Run pnpm install in \/w/);
  });

  it("reads the checkout's version, or null", () => {
    const run = vi.fn();
    expect(devGit({ dir: "/w", run, readFile: () => '{"version":"0.8.2"}' }).diskVersion()).toBe("0.8.2");
    expect(devGit({ dir: "/w", run, readFile: () => "nope" }).diskVersion()).toBeNull();
    expect(devGit({ dir: "/w", run, readFile: () => "{}" }).diskVersion()).toBeNull();
  });

  it("lists no changes between a commit and itself", async () => {
    const { run, calls } = fakeRun({});
    expect(await devGit({ dir: "/w", run }).changed(A, A)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

it("needsRestart: Electron's code or package.json", () => {
  expect(needsRestart(["electron/main.cjs"])).toBe(true);
  expect(needsRestart(["package.json"])).toBe(true);
  expect(needsRestart(["lib/x.ts", "app/page.tsx"])).toBe(false);
});

// A stand-in git for the wrapper.
function fakeGit(over: Record<string, unknown> = {}) {
  return {
    head: vi.fn(() => Promise.resolve(A)),
    changed: vi.fn(() => Promise.resolve([] as string[])),
    diskVersion: vi.fn(() => "0.8.0"),
    survey: vi.fn(() => Promise.resolve(({ from: A, target: B, behind: 2, ahead: 0, notes: "- one" }))),
    pull: vi.fn(() => Promise.resolve(["lib/x.ts"])),
    ...over,
  };
}

function wrap(git = fakeGit(), extra: Record<string, unknown> = {}) {
  const relaunch = vi.fn(() => Promise.resolve());
  const onChange = vi.fn();
  const openWindow = vi.fn();
  const b = base();
  const u = withDevUpdates(b, { git, currentVersion: "0.8.0", relaunch, onChange, openWindow, log: { warn: () => {} }, ...extra });
  return { u, git, relaunch, onChange, openWindow, b };
}

describe("withDevUpdates", () => {
  it("finds new commits on main and pulls them without a restart", async () => {
    const { u, git, relaunch } = wrap();
    await u.check();
    expect(u.state()).toMatchObject({ phase: "available", commits: 2, target: "bbbbbbb", notes: "- one" });
    expect(u.info()).toMatchObject({ dev: true, currentVersion: "0.8.0", state: { phase: "available" } });
    expect(u.menuItem().label).toBe("Update Weft (2 new)…");
    await u.download();
    expect(git.pull).toHaveBeenCalledWith(A, B);
    expect(u.state()).toMatchObject({ phase: "idle", upToDate: true, pulled: 2 });
    expect(await u.install()).toBe(false);
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("asks for a restart when a pull moved Electron's code, and restarts when idle", async () => {
    const { u, relaunch } = wrap(fakeGit({ pull: vi.fn(() => Promise.resolve(["electron/main.cjs"])) }));
    await u.check();
    await u.pull();
    expect(u.state().phase).toBe("ready");
    expect(u.menuItem().label).toBe("Restart to Update…");
    expect(await u.install()).toBe(true);
    expect(relaunch).toHaveBeenCalled();
    expect(u.installNow()).toBe(false);
  });

  it("a checkout already pulled past the running version is ready to restart", async () => {
    const { u } = wrap(fakeGit({ survey: vi.fn(() => Promise.resolve(({ from: A, target: A, behind: 0, ahead: 0, notes: "" }))), diskVersion: () => "0.8.2" }));
    await u.check();
    expect(u.state()).toMatchObject({ phase: "ready", version: "0.8.2", target: "aaaaaaa" });
  });

  it("a terminal pull that changed electron/ since launch is ready too; otherwise up to date", async () => {
    const current = { survey: vi.fn(() => Promise.resolve(({ from: B, target: B, behind: 0, ahead: 0, notes: "" }))) };
    const moved = wrap(fakeGit({ ...current, head: vi.fn(() => Promise.resolve(A)), changed: vi.fn(() => Promise.resolve(["electron/x.cjs"])) }));
    await moved.u.check();
    expect(moved.u.state().phase).toBe("ready");
    const same = wrap(fakeGit(current));
    await same.u.check();
    expect(same.u.state()).toMatchObject({ phase: "idle", upToDate: true });
    const noHead = wrap(fakeGit({ ...current, head: vi.fn(() => Promise.reject(new Error("no git"))) }));
    await noHead.u.check();
    expect(noHead.u.state()).toMatchObject({ upToDate: true });
  });

  it("refuses a checkout that diverged from main", async () => {
    const { u } = wrap(fakeGit({ survey: vi.fn(() => Promise.resolve(({ from: A, target: B, behind: 2, ahead: 1, notes: "" }))) }));
    await u.check();
    expect(u.state().error).toMatch(/1 commit origin\/main doesn't/);
    const many = wrap(fakeGit({ survey: vi.fn(() => Promise.resolve(({ from: A, target: B, behind: 2, ahead: 3, notes: "" }))) }));
    await many.u.check();
    expect(many.u.state().error).toMatch(/3 commits/);
  });

  it("a failed check keeps an update it already found, else shows the error", async () => {
    const survey = vi.fn(() => Promise.resolve(({ from: A, target: B, behind: 2, ahead: 0, notes: "" })));
    const { u } = wrap(fakeGit({ survey }));
    await u.check();
    survey.mockRejectedValueOnce(new Error("offline"));
    await u.check();
    expect(u.state().phase).toBe("available");
    const fresh = wrap(fakeGit({ survey: vi.fn(() => Promise.reject(new Error("offline"))) }));
    await fresh.u.check();
    expect(fresh.u.state()).toMatchObject({ phase: "idle", error: "offline" });
  });

  it("a failed pull shows why; pull and check do nothing at the wrong time", async () => {
    const { u, git } = wrap(fakeGit({ pull: vi.fn(() => Promise.reject(new Error("git couldn't fast-forward: dirty"))) }));
    await u.pull();
    expect(git.pull).not.toHaveBeenCalled();
    await u.check();
    await u.pull();
    expect(u.state()).toMatchObject({ phase: "idle", error: "git couldn't fast-forward: dirty" });
    let release: () => void = () => {};
    git.survey.mockImplementationOnce(() => new Promise((r) => (release = () => r({ from: A, target: A, behind: 0, ahead: 0, notes: "" }))));
    const first = u.check();
    await u.check();
    expect(git.survey).toHaveBeenCalledTimes(2);
    release();
    await first;
  });

  it("the menu item opens the window and checks when idle", () => {
    const { u, openWindow, git } = wrap();
    const item = u.menuItem();
    expect(item.label).toBe("Check for Updates…");
    item.click();
    expect(openWindow).toHaveBeenCalled();
    expect(git.survey).toHaveBeenCalled();
    const bare = withDevUpdates(base(), { git: fakeGit(), currentVersion: "0.8.0", relaunch: vi.fn() });
    bare.menuItem().click();
  });

  it("checks on a timer from start, and stop clears it", async () => {
    vi.useFakeTimers();
    try {
      const { u, git, b } = wrap();
      u.start();
      u.start();
      expect(b.start).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(git.survey).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
      expect(git.survey).toHaveBeenCalledTimes(2);
      u.stop();
      expect(b.stop).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
      expect(git.survey).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
