import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "../cloud-commands";
import type { WakeHooks } from "../worker-wake";
import type { CommandLine } from "./identity";
import { createInbox, startPolling, type Connection } from "./inbox";

const row = (id: string, kind = "reply") => ({ id, kind }) as CloudCommandRow;

function fakeLine(pending: CloudCommandRow[] = []) {
  const line = {
    pending: vi.fn<CommandLine["pending"]>(() => Promise.resolve(pending)),
    claim: vi.fn<CommandLine["claim"]>(() => Promise.resolve(true)),
    report: vi.fn<CommandLine["report"]>(() => Promise.resolve()),
  };
  return line;
}

describe("createInbox", () => {
  it("claims, runs and reports each pending command, oldest first", async () => {
    const line = fakeLine([row("a"), row("b")]);
    const dispatch = vi.fn((c: CloudCommandRow) => Promise.resolve(`card-${c.id}`));
    const claimed = vi.fn();
    await createInbox({ connect: () => ({ line, dispatch }), claimed, log: vi.fn() }).poll();
    expect(dispatch.mock.calls.map(([c]) => c.id)).toEqual(["a", "b"]);
    expect(line.report.mock.calls).toEqual([
      ["a", { status: "done", cardId: "card-a" }],
      ["b", { status: "done", cardId: "card-b" }],
    ]);
    expect(claimed).toHaveBeenCalledTimes(2);
  });

  it("runs nothing it couldn't claim", async () => {
    const line = fakeLine([row("a")]);
    line.claim.mockResolvedValue(false);
    const dispatch = vi.fn();
    await createInbox({ connect: () => ({ line, dispatch }), log: vi.fn() }).poll();
    expect(dispatch).not.toHaveBeenCalled();
    expect(line.report).not.toHaveBeenCalled();
  });

  it("reports a failure, says so, and survives a failed report", async () => {
    const line = fakeLine([row("a", "host")]);
    line.report.mockRejectedValue(new Error("down"));
    const failed = vi.fn();
    await createInbox({ connect: () => ({ line, dispatch: () => Promise.reject(new Error("no")) }), failed, log: vi.fn() }).poll();
    expect(failed).toHaveBeenCalledWith(row("a", "host"), "no");
    expect(line.report).toHaveBeenLastCalledWith("a", { status: "failed", error: "no", result: { ok: false, error: "no" } });
  });

  it("does nothing with no identity, and logs a failed read", async () => {
    const log = vi.fn();
    await createInbox({ connect: () => Promise.resolve(null), log }).poll();
    expect(log).not.toHaveBeenCalled();
    const line = fakeLine();
    line.pending.mockRejectedValue(new Error("offline"));
    await createInbox({ connect: () => ({ line, dispatch: vi.fn() }), log }).poll();
    expect(log).toHaveBeenCalledWith("offline");
  });

  it("runs an aside kind beside the queue, logs one that throws, and calls after when it ends", async () => {
    const line = fakeLine([row("slow", "clone"), row("next")]);
    let finish = () => {};
    const dispatch = vi.fn((c: CloudCommandRow) => (c.kind === "clone" ? new Promise<string>((resolve) => (finish = () => resolve("k"))) : Promise.resolve("n")));
    const after = vi.fn();
    const inbox = createInbox({ connect: () => ({ line, dispatch }), aside: (c) => c.kind === "clone", after, log: vi.fn() });
    await inbox.poll();
    expect(line.report).toHaveBeenCalledWith("next", { status: "done", cardId: "n" });
    expect(inbox.idle()).toBe(false);
    finish();
    await vi.waitFor(() => expect(inbox.idle()).toBe(true));
    expect(after).toHaveBeenCalledTimes(2);

    const log = vi.fn();
    const broken = fakeLine([row("c", "clone")]);
    broken.claim.mockRejectedValue(new Error("gone"));
    await createInbox({ connect: () => ({ line: broken, dispatch }), aside: () => true, log }).poll();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("gone"));
  });

  it("holds every pass while paused", async () => {
    const line = fakeLine();
    await createInbox({ connect: () => ({ line, dispatch: vi.fn() }), paused: () => true, log: vi.fn() }).poll();
    expect(line.pending).not.toHaveBeenCalled();
  });

  it("runs one command it's handed", async () => {
    const line = fakeLine();
    const conn: Connection = { line, dispatch: () => Promise.resolve(null) };
    await createInbox({ connect: () => conn, log: vi.fn() }).run(conn, row("a"));
    expect(line.report).toHaveBeenCalledWith("a", { status: "done", cardId: null });
  });
});

describe("startPolling", () => {
  afterEach(() => vi.useRealTimers());

  it("polls fast until the socket joins, slow while it's up, fast again when it drops", () => {
    vi.useFakeTimers();
    const poll = vi.fn();
    let hooks: WakeHooks | undefined;
    const leave = vi.fn();
    const stop = startPolling(poll, { fastMs: 3, slowMs: 30, listen: (h) => ((hooks = h), leave) });
    vi.advanceTimersByTime(9);
    expect(poll).toHaveBeenCalledTimes(3);
    hooks?.up();
    expect(poll).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(29);
    expect(poll).toHaveBeenCalledTimes(4);
    hooks?.ping();
    expect(poll).toHaveBeenCalledTimes(5);
    hooks?.down();
    hooks?.down();
    vi.advanceTimersByTime(3);
    expect(poll).toHaveBeenCalledTimes(6);
    stop();
    expect(leave).toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(poll).toHaveBeenCalledTimes(6);
  });

  it("keeps one pace with no socket, and with no slow pace", () => {
    vi.useFakeTimers();
    const poll = vi.fn();
    let hooks: WakeHooks | undefined;
    const stop = startPolling(poll, { fastMs: 5, listen: (h) => ((hooks = h), () => {}) });
    hooks?.up();
    vi.advanceTimersByTime(10);
    expect(poll).toHaveBeenCalledTimes(3);
    stop();
    const bare = startPolling(poll, { fastMs: 5 });
    vi.advanceTimersByTime(5);
    expect(poll).toHaveBeenCalledTimes(4);
    bare();
  });
});

describe("state handed in", () => {
  it("keeps its single-flight flags in the state, so a rebuilt inbox can't overlap a pass in flight", async () => {
    const state = { polling: true, again: false, aside: 0 };
    const line = fakeLine();
    await createInbox({ connect: () => ({ line, dispatch: vi.fn() }), log: vi.fn(), state }).poll();
    expect(line.pending).not.toHaveBeenCalled();
    expect(state.again).toBe(true);
  });
});
