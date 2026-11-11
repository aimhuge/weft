import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./new-card", () => ({ createCardFromBody: vi.fn((body: Record<string, unknown>) => ({ id: "local-1", ...body })) }));
vi.mock("./store", () => ({ updateCard: vi.fn((id: string, patch: Record<string, unknown>) => ({ id, ...patch })) }));
vi.mock("./repos", () => ({ localRepos: vi.fn(() => [{ path: "/Users/me/dev/weft" }]) }));
vi.mock("./workers-account", () => ({ commandResult: vi.fn() }));

import { createCardFromBody } from "./new-card";
import { updateCard } from "./store";
import { commandResult } from "./workers-account";
import { keepRefused, localFolderFor, refusedLine, REFUSED_TAG, WATCH_MS, watchWorkerRun, type RefusedDeps } from "./worker-refused";

const input = { cwd: "worker://w1/weft", prompt: "fable 5.2 is out. Please update our model selection", agent: "builder", model: "claude-opus-5-5", tags: ["models"] };

function deps(results: ({ status: string; error?: string | null } | Error)[]): RefusedDeps & { keep: ReturnType<typeof vi.fn> } {
  let t = 0;
  const queue = [...results];
  return {
    read: vi.fn(() => {
      const next = queue.shift() ?? { status: "pending" };
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    }),
    keep: vi.fn(() => ({ id: "kept" }) as never),
    sleep: vi.fn((ms: number) => {
      t += ms;
      return Promise.resolve();
    }),
    now: () => t,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("localFolderFor", () => {
  it("is the repo on this Mac with the worker folder's name", () => {
    expect(localFolderFor("worker://w1/weft", [{ path: "/a/other" }, { path: "/Users/me/dev/weft" }])).toBe("/Users/me/dev/weft");
  });

  it("is home when no repo here has that name, or the path isn't a worker's", () => {
    expect(localFolderFor("worker://w1/ling", [{ path: "/Users/me/dev/weft" }])).toBe(os.homedir());
    expect(localFolderFor("/Users/me/dev/weft", [{ path: "/Users/me/dev/weft" }])).toBe(os.homedir());
  });

  it("reads this Mac's repos by default", () => {
    expect(localFolderFor("worker://w1/weft")).toBe("/Users/me/dev/weft");
  });
});

describe("refusedLine", () => {
  it("names the worker and its reason, and what to do", () => {
    expect(refusedLine("m1mini", "This worker trusts no Mac yet. ")).toBe(
      "m1mini didn't take this thread: This worker trusts no Mac yet. It's here instead: start it on this Mac, or fix m1mini and send it again.",
    );
  });
});

describe("keepRefused", () => {
  it("makes the thread here, in the matching project, tagged, in Needs you with the reason", () => {
    const card = keepRefused(input, "m1mini", "trusts no Mac.");
    expect(createCardFromBody).toHaveBeenCalledWith(expect.objectContaining({ prompt: input.prompt, agent: "builder", model: "claude-opus-5-5", cwd: "/Users/me/dev/weft", tags: ["models", REFUSED_TAG] }));
    expect(updateCard).toHaveBeenCalledWith("local-1", { column: "needs_you", lastLine: refusedLine("m1mini", "trusts no Mac.") });
    expect(card).toMatchObject({ id: "local-1", column: "needs_you" });
  });

  it("tags it once when it came with no tags", () => {
    keepRefused({ cwd: "worker://w1/weft", prompt: "hi" }, "m1mini", "no.");
    expect(createCardFromBody).toHaveBeenCalledWith(expect.objectContaining({ tags: [REFUSED_TAG] }));
  });
});

describe("watchWorkerRun", () => {
  it("keeps a refused run on this board", async () => {
    const d = deps([{ status: "claimed" }, { status: "failed", error: "This worker trusts no Mac yet." }]);
    await expect(watchWorkerRun("cmd-1", "m1mini", input, d)).resolves.toEqual({ id: "kept" });
    expect(d.keep).toHaveBeenCalledWith(input, "m1mini", "This worker trusts no Mac yet.");
  });

  it("says the worker gave no reason when the failure has none", async () => {
    const d = deps([{ status: "failed", error: null }]);
    await watchWorkerRun("cmd-1", "m1mini", input, d);
    expect(d.keep).toHaveBeenCalledWith(input, "m1mini", "it gave no reason.");
  });

  it("leaves a run the worker took alone", async () => {
    const d = deps([{ status: "done" }]);
    await expect(watchWorkerRun("cmd-1", "m1mini", input, d)).resolves.toBeNull();
    expect(d.keep).not.toHaveBeenCalled();
  });

  it("asks again after a read that fails, and gives up after WATCH_MS on one still queued", async () => {
    const d = deps([new Error("offline")]);
    await expect(watchWorkerRun("cmd-1", "m1mini", input, d)).resolves.toBeNull();
    expect(d.keep).not.toHaveBeenCalled();
    expect((d.read as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
    expect(d.now()).toBeGreaterThanOrEqual(WATCH_MS);
  });

  it("reads the command through the account by default", async () => {
    vi.mocked(commandResult).mockResolvedValue({ status: "done" } as never);
    vi.useFakeTimers();
    const done = watchWorkerRun("cmd-9", "m1mini", input);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(done).resolves.toBeNull();
    expect(commandResult).toHaveBeenCalledWith("cmd-9");
    vi.useRealTimers();
  });

  it("keeps through keepRefused by default", async () => {
    vi.mocked(commandResult).mockResolvedValue({ status: "failed", error: "no." } as never);
    vi.useFakeTimers();
    const done = watchWorkerRun("cmd-9", "m1mini", input);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(done).resolves.toMatchObject({ column: "needs_you" });
    vi.useRealTimers();
  });
});
