import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const holdBack = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
const cards = new Map<string, Card>();
vi.mock("./commit-held", () => ({ holdBack }));
vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id), listCards: () => [...cards.values()] }));

const { commitHeldGuard, commitHeldHook, namedPaths } = await import("./commit-held-guard");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "held-guard-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
git("init", "-q");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
fs.mkdirSync(path.join(root, "docs"));
fs.writeFileSync(path.join(root, "docs/a.md"), "a\n");
fs.writeFileSync(path.join(root, "b.md"), "b\n");
git("add", ".");
git("commit", "-qm", "base");
fs.writeFileSync(path.join(root, "docs/a.md"), "changed\n");
fs.writeFileSync(path.join(root, "b.md"), "changed\n");

const hook = (id: string) => commitHeldGuard(() => id);
const call = (run: ReturnType<typeof hook>, command: unknown, event = "PreToolUse") =>
  run({ hook_event_name: event, cwd: root, tool_input: { command } } as never, "t", { signal: new AbortController().signal });

beforeEach(() => {
  holdBack.mockClear();
  cards.set("me", { id: "me", cwd: root } as Card);
});

describe("commitHeldGuard", () => {
  it("holds back the changed paths a commit.sh line names", async () => {
    await call(hook("me"), 'bash /x/commit.sh "docs: note" docs/a.md');
    expect(holdBack).toHaveBeenCalledWith(root, ["docs/a.md"], cards.get("me"), [cards.get("me")]);
  });

  it("leaves every other command alone", async () => {
    await call(hook("me"), "git status");
    await call(hook("me"), 5);
    await call(hook("me"), "bash commit.sh x b.md", "PostToolUse");
    await call(hook("nobody"), "bash commit.sh x b.md");
    expect(holdBack).not.toHaveBeenCalled();
  });

  it("carries on with no paths when git can't list them", async () => {
    await expect(namedPaths("/nowhere", "x")).rejects.toThrow();
    expect(await namedPaths(root, "bash commit.sh m b.md")).toEqual(["b.md"]);
  });

  it("runs on Bash", () => {
    expect(commitHeldHook(() => "me").matcher).toBe("Bash");
  });
});
