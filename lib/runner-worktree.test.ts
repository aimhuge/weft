// @vitest-environment node
// An isolated card's CLI runs in its worktree (docs/architecture/worktrees.md), against the fake SDK in lib/runner.harness.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness, success } from "./runner.harness";
import type { Card } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
const take = vi.hoisted(() => vi.fn());
vi.mock("./worktree-pool", () => ({ takeWorktree: take }));
const land = vi.hoisted(() => vi.fn());
vi.mock("./worktree-done", () => ({ landCard: land }));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

let runner: typeof import("./runner");
let cwd: string;
const wtPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-runner-wt-")));
const worktree = { path: wtPath, branch: "weft/x-abc123", base: "abc", repo: "/repo" };
const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("isolated cards", () => {
  it("start their CLI in the worktree, with the project kept for project-wide tools", async () => {
    addCard({ id: "c1", isolated: true, worktree });
    runner.sendMessage("c1", "hello");
    await flush();
    expect(nth(h.queries, -1, "query").options.cwd).toBe(wtPath);
    const { specFor } = await import("./runner-state");
    expect(specFor(h.cards.get("c1")!)).toMatchObject({ cwd: wtPath, project: cwd });
  });

  it("never take the project's spare CLI, which runs in the shared tree", async () => {
    const { adoptSpare } = await import("./runner-session");
    addCard({ id: "c1", isolated: true, worktree });
    expect(adoptSpare(h.cards.get("c1")!)).toBeUndefined();
  });

  it("hold the first message until the worktree is taken, then start in it", async () => {
    take.mockResolvedValue(worktree);
    addCard({ id: "c1", isolated: true });
    const { warmUp } = await import("./runner-session");
    warmUp("c1");
    runner.sendMessage("c1", "hello");
    runner.sendMessage("c1", "again");
    await flush(4);
    expect(take).toHaveBeenCalledTimes(1);
    expect(h.cards.get("c1")!.worktree).toEqual(worktree);
    expect(nth(h.queries, -1, "query").options.cwd).toBe(wtPath);
  });

  it("never fall back to the shared tree on their own when no worktree can be had", async () => {
    take.mockRejectedValue(new Error("not a git repo."));
    addCard({ id: "c1", isolated: true });
    runner.sendMessage("c1", "hello");
    await flush(4);
    expect(h.queries).toHaveLength(0);
    expect(h.cards.get("c1")).toMatchObject({ column: "needs_you", isolated: false });
    expect(h.cards.get("c1")!.error).toMatch(/not a git repo\. It now works in the shared folder/);
  });

  it("refuse a session for a card still waiting on its worktree", async () => {
    addCard({ id: "c1", isolated: true });
    const { warmUp } = await import("./runner-session");
    warmUp("c1");
    expect(h.queries).toHaveLength(0);
  });

  it("land their branch when the wrap-up ends instead of being archived straight off", async () => {
    land.mockReset();
    addCard({ id: "c1", column: "done", isolated: true, worktree });
    runner.queueMessages("c1", ["/weft:done"]);
    runner.archiveWhenIdle("c1");
    await flush();
    nth(h.queries, -1, "query").emit(success("committed"));
    await flush();
    expect(land).toHaveBeenCalledWith("c1", expect.any(Function));
    expect(h.cards.get("c1")!.archived).toBeFalsy();
    (land.mock.calls[0]![1] as (id: string, text: string) => void)("c1", "resolve it");
    await flush();
    expect(nth(h.queries, -1, "query").received).toContain("resolve it");
  });

  it("land at once when there's no wrap-up turn to wait for, and not when the wrap-up ends in Review", async () => {
    land.mockReset();
    addCard({ id: "c1", column: "done", isolated: true, worktree });
    runner.archiveWhenIdle("c1");
    expect(land).toHaveBeenCalledTimes(1);
    addCard({ id: "c2", column: "done", isolated: true, worktree });
    runner.queueMessages("c2", ["/weft:done"]);
    runner.archiveWhenIdle("c2");
    await flush();
    nth(h.queries, -1, "query").emit(success("push failed\nBOARD STATUS: column=review | stage=Cleaning up | remaining=push"));
    await flush();
    expect(land).toHaveBeenCalledTimes(1);
  });
});
