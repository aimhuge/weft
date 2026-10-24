import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GIT_GUARD_MATCHER, gitGuard, gitTarget, gitVerdict, hookTarget } from "./git-guard";

const DIR = "/Users/me/dev/weft";
const hits = (command: string, cwd = DIR) => gitTarget(command, cwd);

describe("gitTarget", () => {
  it.each([
    "git stash",
    "git stash push -m wip",
    "git stash -u",
    "git stash pop",
    "git stash drop",
    "git stash clear",
    "git reset --hard",
    "git reset --hard HEAD~1",
    "git checkout -- lib/a.ts",
    "git checkout HEAD -- lib/a.ts",
    "git checkout .",
    "git checkout ./",
    "git checkout HEAD lib/a.ts",
    "git checkout ':/lib'",
    "git checkout '*.ts'",
    "git checkout -f main",
    "git checkout --force main",
    "git switch --discard-changes main",
    "git switch -f main",
    "git restore lib/a.ts",
    "git restore .",
    "git restore --staged --worktree lib/a.ts",
    "git restore -SW lib/a.ts",
    "git clean -f",
    "git clean -fdx",
    "git clean --force -d",
    "git -C /Users/me/dev/weft stash",
    "git -c core.pager=cat reset --hard",
    "git --no-pager stash",
    "cd /Users/me/dev/weft && git stash",
    "npm test && git stash && git stash pop",
    "bash -c 'git reset --hard'",
    "sudo git clean -fd",
    "env GIT_DIR=.git git stash",
    "echo $(git stash)",
  ])("catches %s", (command) => {
    expect(hits(command)).toBeTruthy();
  });

  it.each([
    "git stash list",
    "git stash show -p stash@{0}",
    "git status",
    "git diff",
    "git reset",
    "git reset -q -- lib/a.ts",
    "git reset --soft HEAD~1",
    "git checkout main",
    "git checkout -b feat",
    "git checkout -b feat origin/feat",
    "git checkout -B feat origin/feat",
    "git checkout --orphan gh-pages",
    "git checkout -- ",
    "git switch main",
    "git switch -c feat",
    "git restore --staged lib/a.ts",
    "git restore -S lib/a.ts",
    "git clean -n",
    "git clean -nfd",
    "git clean -f --dry-run",
    "git show HEAD:lib/a.ts > /tmp/a.ts",
    "git",
    "git -C",
    "git commit -m wip -- lib/a.ts",
    "ls -la",
  ])("leaves %s alone", (command) => {
    expect(hits(command)).toBeNull();
  });

  it("names what it would do", () => {
    expect(hits("git stash")).toContain("git stash");
    expect(hits("git reset --hard")).toContain("reset --hard");
    expect(hits("git checkout .")).toContain("over paths");
    expect(hits("git checkout -f main")).toContain("--force");
    expect(hits("git switch -f main")).toContain("discard-changes");
    expect(hits("git restore a.ts")).toContain("restore");
    expect(hits("git clean -f")).toContain("untracked");
  });

  it("leaves a scratch clone in the temp folder alone", () => {
    expect(hits("git reset --hard", "/tmp/clone")).toBeNull();
    expect(hits("git stash", "/private/tmp/clone")).toBeNull();
    expect(hits("git stash", os.tmpdir())).toBeNull();
    expect(hits("cd /tmp/clone && git clean -fdx")).toBeNull();
    expect(hits("git -C /tmp/clone reset --hard")).toBeNull();
    expect(hits("git -C ../weft stash", "/tmp/x")).toBeNull();
    expect(hits("git -C .. stash", "/tmp/x")).toBeNull();
    expect(hits("git -C .. stash", "/tmp")).toBeTruthy();
    expect(hits("cd /tmp && git -C /Users/me/dev/weft stash")).toBeTruthy();
    expect(hits("git stash", "/tmpfoo")).toBeTruthy();
  });

  it("lets an isolated card discard changes in its own worktree, but never stash or reach another tree", () => {
    // A real ~/.weft, not the test sandbox's (which is under the temp folder, so already scratch).
    const saved = process.env.WEFT_DATA;
    process.env.WEFT_DATA = "/Users/me/.weft";
    const root = "/Users/me/.weft/worktrees";
    const mine = path.join(root, "weft-abc123", "card1");
    const theirs = path.join(root, "weft-abc123", "card2");
    expect(hits("git reset --hard", mine)).toBeNull();
    expect(hits("git checkout -- src/a.ts", path.join(mine, "src"))).toBeNull();
    expect(hits("git clean -fd && git restore .", mine)).toBeNull();
    expect(hits("git stash", mine)).toBeTruthy();
    expect(hits(`git -C ${theirs} reset --hard`, mine)).toBeTruthy();
    expect(hits(`git -C ${DIR} checkout .`, mine)).toBeTruthy();
    expect(hits(`git -C ${mine} reset --hard`)).toBeTruthy();
    expect(hits("git reset --hard", root)).toBeTruthy();
    process.env.WEFT_DATA = saved;
  });
});

describe("gitVerdict", () => {
  it("lets a safe command run", () => {
    expect(gitVerdict("git status", DIR)).toBeNull();
  });

  it("says why, and points to the safe ways", () => {
    const why = gitVerdict("git stash", DIR) ?? "";
    expect(why).toContain("Other cards' uncommitted work lives in this tree");
    expect(why).toContain("Commit by path");
    expect(why).toContain("git show HEAD:path > /tmp/x");
    expect(why).toContain("GIT_INDEX_FILE=/tmp/idx");
    expect(why).toContain("ask the user");
  });
});

describe("hookTarget", () => {
  it("turns away what skips or unhooks the pre-commit hook", () => {
    expect(hookTarget("git commit --no-verify -m x", DIR)).toContain("--no-verify");
    expect(hookTarget("git commit -nm x", DIR)).toContain("--no-verify");
    expect(hookTarget("git config core.hooksPath /Users/me/dev/weft/.git/hooks", DIR)).toContain("core.hooksPath");
    expect(hookTarget("git config --unset core.hooksPath", DIR)).toContain("unsetting");
    expect(hookTarget("git -c core.hooksPath=/dev/null commit -m x", DIR)).toContain("skips the pre-commit hook");
  });

  it("lets reads, the repo's own .githooks, plain commits and scratch repos through", () => {
    expect(hookTarget("git commit -m 'fix' -- a.ts", DIR)).toBeNull();
    expect(hookTarget("git commit --amend --no-edit", DIR)).toBeNull();
    expect(hookTarget("git config core.hooksPath", DIR)).toBeNull();
    expect(hookTarget("git config --get core.hooksPath", DIR)).toBeNull();
    expect(hookTarget("git config core.hooksPath .githooks", DIR)).toBeNull();
    expect(hookTarget("git -C /tmp/x config core.hooksPath .no-hooks", DIR)).toBeNull();
    expect(hookTarget("git commit -n -m x", os.tmpdir())).toBeNull();
  });

  it("gives the hook's own reason", () => {
    expect(gitVerdict("git commit --no-verify -m x", DIR)).toContain("scripts/check-staged.sh");
  });
});

describe("gitGuard", () => {
  const call = (input: Record<string, unknown>) => gitGuard(input as never, undefined, { signal: new AbortController().signal });

  it("denies a command that would throw away other cards' work", async () => {
    const out = await call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git stash" }, cwd: DIR });
    expect(out).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  });

  it("lets everything else through", async () => {
    expect(await call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git status" }, cwd: DIR })).toEqual({});
    expect(await call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {}, cwd: DIR })).toEqual({});
    expect(await call({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { command: "git stash" }, cwd: DIR })).toEqual({});
    expect(await call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git stash" }, cwd: DIR })).toEqual({});
  });

  it("comes as a Bash PreToolUse hook", () => {
    expect(GIT_GUARD_MATCHER.matcher).toBe("Bash");
    expect(GIT_GUARD_MATCHER.hooks).toEqual([gitGuard]);
  });
});
