import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command, makeDeps } from "./worker-daemon.harness";

// The daemon's clone and GitHub commands (docs/architecture/weft-worker.md#cloning-onto-a-worker).
describe("clone and github_login", () => {
  it("clones a repo with no card, and reports it done", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "clone", payload: { repo: "https://github.com/a/b.git" } as never }));
    expect(d.clone).toHaveBeenCalledWith("weft", "https://github.com/a/b.git");
    expect(d.start).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", null, null);
  });

  it("fails a clone that names no repo", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "clone", payload: {} as never }));
    expect(d.clone).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That clone names no repo.");
  });

  it("reports a clone that failed for want of a sign-in in plain words, and updates the row", async () => {
    const d = makeDeps();
    d.clone.mockRejectedValue(new Error("fatal: could not read Username for 'https://github.com'"));
    await d.daemon.runOne(command({ kind: "clone", payload: { repo: "https://github.com/a/b.git" } as never }));
    expect(d.setGithub).toHaveBeenCalledWith("none", null);
    const [, status, , error] = d.report.mock.calls[0] as [string, string, null, string];
    expect(status).toBe("failed");
    expect(error).toContain("isn't signed in to GitHub");
  });

  it("signs git in to GitHub, puts the account on the row and doesn't restart", async () => {
    const d = makeDeps();
    const token = { v: 1, epk: "ZXBr", iv: "aXY=", ct: "Y3Q=", tag: "dGFn" };
    await d.daemon.runOne(command({ kind: "github_login", folder: "-", payload: { token } as never }));
    expect(d.github.login).toHaveBeenCalledWith(token);
    expect(d.login).not.toHaveBeenCalled();
    expect(d.setGithub).toHaveBeenCalledWith("signed_in", "octocat");
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", null, null);
  });

  it("reports the real reason a GitHub sign-in failed, and one with no sealed token", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "github_login", payload: { token: "github_pat_plain" } as never }));
    expect(d.report).toHaveBeenLastCalledWith("cmd-1", "failed", null, "That sign-in carries no sealed token.");
    d.github.login.mockRejectedValueOnce(new Error("GitHub refused that token."));
    await d.daemon.runOne(command({ kind: "github_login", payload: { token: { v: 1, epk: "a", iv: "b", ct: "c", tag: "d" } } as never }));
    expect(d.report).toHaveBeenLastCalledWith("cmd-1", "failed", null, "GitHub refused that token.");
    expect(d.setGithub).not.toHaveBeenCalled();
  });

  it("logs a sign-in it couldn't publish, and still reports the sign-in done", async () => {
    const d = makeDeps();
    d.setGithub.mockRejectedValue(new Error("worker_set_github: missing"));
    await d.daemon.runOne(command({ kind: "github_login", payload: { token: { v: 1, epk: "a", iv: "b", ct: "c", tag: "d" } } as never }));
    expect(d.log).toHaveBeenCalledWith("Weft Worker: GitHub sign-in: worker_set_github: missing");
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", null, null);
  });
});

describe("polling", () => {
  it("doesn't hold a reply behind a slow clone", async () => {
    const d = makeDeps();
    d.clone.mockImplementation(() => new Promise(() => {}));
    d.pending.mockResolvedValue([
      command({ id: "cmd-1", kind: "clone", payload: { repo: "https://github.com/a/b.git" } as never }),
      command({ id: "cmd-2", kind: "stop", payload: { cardId: "card-1" } as never }),
    ]);
    await d.daemon.poll();
    expect(d.stop).toHaveBeenCalledWith("card-1");
  });

  it("logs a clone it couldn't claim", async () => {
    const d = makeDeps();
    d.claim.mockRejectedValue(new Error("offline"));
    d.pending.mockResolvedValue([command({ kind: "clone", payload: { repo: "https://github.com/a/b.git" } as never })]);
    await d.daemon.poll();
    await vi.waitFor(() => expect(d.log).toHaveBeenCalledWith("Weft Worker: offline"));
  });
});

describe("start", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("publishes the GitHub sign-in at start and every hour, and keeps the row when GitHub can't say", async () => {
    const d = makeDeps();
    const stop = d.daemon.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.setGithub).toHaveBeenCalledExactlyOnceWith("none", null);
    d.github.status.mockResolvedValue({ state: "expired", account: null });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(d.setGithub).toHaveBeenLastCalledWith("expired", null);
    d.setGithub.mockClear();
    d.github.status.mockResolvedValue(null);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(d.setGithub).not.toHaveBeenCalled();
    await stop();
  });
});
