import { describe, expect, it, vi } from "vitest";
import { createDaemon } from "./worker-daemon";
import { card, command, fakeEngine, fakeGithub, fakePublisher, fakeReg, makeDeps } from "./worker-daemon.harness";

describe("the daemon", () => {
  it("claims a run and makes a card in the checkout", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command());
    expect(d.claim).toHaveBeenCalledWith("cmd-1");
    expect(d.checkout).toHaveBeenCalledWith("weft", undefined);
    expect(d.start).toHaveBeenCalledWith({ prompt: "Add dark mode", cwd: "/srv/work/weft", permissionMode: "acceptEdits" });
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", "card-1", null);
  });

  it("clones the repo the run named, and doesn't pass it to the engine", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ payload: { prompt: "go", repo: "https://github.com/a/b.git" } as never }));
    expect(d.checkout).toHaveBeenCalledWith("weft", "https://github.com/a/b.git");
    const started = d.start.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(started.repo).toBeUndefined();
  });

  it("starts in the mode the run asked for", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ payload: { prompt: "go", permissionMode: "plan" } as never }));
    expect(d.start).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: "plan" }));
  });

  it("names the folder and tracks the card, then flushes before it reports", async () => {
    const d = makeDeps();
    const order: string[] = [];
    d.nameFolder.mockImplementation(() => {
      order.push("nameFolder");
    });
    d.track.mockImplementation(() => {
      order.push("track");
    });
    d.flush.mockImplementation(() => {
      order.push("flush");
      return Promise.resolve();
    });
    d.report.mockImplementation(() => {
      order.push("report");
      return Promise.resolve();
    });
    await d.daemon.runOne(command());
    expect(d.nameFolder).toHaveBeenCalledWith("card-1", "weft");
    expect(d.track).toHaveBeenCalledWith("card-1");
    expect(order).toEqual(["nameFolder", "track", "flush", "report"]);
  });

  it("does nothing when it can't claim the command", async () => {
    const d = makeDeps();
    d.claim.mockResolvedValue(false);
    await d.daemon.runOne(command());
    expect(d.start).not.toHaveBeenCalled();
    expect(d.report).not.toHaveBeenCalled();
  });

  it("runs a new_card command too", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "new_card", payload: { prompt: "Add dark mode" } as never }));
    expect(d.checkout).toHaveBeenCalledWith("weft", undefined);
    expect(d.start).toHaveBeenCalledWith({
      prompt: "Add dark mode",
      title: undefined,
      backend: undefined,
      model: undefined,
      effort: undefined,
      tags: undefined,
      cwd: "/srv/work/weft",
      permissionMode: "acceptEdits",
    });
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", "card-1", null);
  });

  it("replies to a card it runs", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "reply", payload: { cardId: "card-1", text: "go on" } as never }));
    expect(d.reply).toHaveBeenCalledWith("card-1", "go on");
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", "card-1", null);
  });

  describe("a folder grant on an answer", () => {
    const folderPrompt = { id: "p-1", toolName: "Read", title: "t", input: {}, readScope: { directory: "/home/w/data", token: "~/data" } };
    const eng = (pending: unknown) => fakeEngine({ "card-1": card({ pending } as never) });
    const run = async (engine: ReturnType<typeof fakeEngine>, payload: Record<string, unknown>) => {
      const d = makeDeps({ engine: engine.engine });
      await d.daemon.runOne(command({ kind: "answer", payload: { cardId: "card-1", pendingId: "p-1", allow: true, ...payload } as never }));
      return d;
    };

    it("grants the folder of the waiting request, after the answer, and ignores a path off the network", async () => {
      const engine = eng(folderPrompt);
      const d = await run(engine, { grant: "always", directory: "/" });
      expect(engine.answer).toHaveBeenCalledWith("card-1", true, undefined, "p-1");
      expect(engine.grant).toHaveBeenCalledWith("card-1", "/home/w/data", "always");
      expect(engine.answer.mock.invocationCallOrder[0]).toBeLessThan(engine.grant.mock.invocationCallOrder[0] as number);
      expect(d.report).toHaveBeenCalledWith("cmd-1", "done", "card-1", null);
    });

    it("leaves no grant when the request has gone from under the answer", async () => {
      const engine = eng(folderPrompt);
      engine.answer.mockImplementation(() => {
        throw new Error("That request isn't waiting anymore.");
      });
      const d = await run(engine, { grant: "card" });
      expect(engine.grant).not.toHaveBeenCalled();
      expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That request isn't waiting anymore.");
    });

    it("answers nothing when the grant can't be given", async () => {
      const engine = eng({ ...folderPrompt, id: "p-2" });
      const d = await run(engine, { grant: "card" });
      expect(engine.answer).not.toHaveBeenCalled();
      expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That request isn't waiting anymore.");
    });

    it("never grants on a Deny", async () => {
      const engine = eng(folderPrompt);
      await run(engine, { allow: false, grant: "always" });
      expect(engine.answer).toHaveBeenCalledWith("card-1", false, undefined, "p-1");
      expect(engine.grant).not.toHaveBeenCalled();
    });
  });

  it("answers a card it runs", async () => {
    const d = makeDeps();
    await d.daemon.runOne(
      command({ kind: "answer", payload: { cardId: "card-1", pendingId: "p-1", allow: true, answers: { q: "a" } } as never }),
    );
    expect(d.answer).toHaveBeenCalledWith("card-1", true, { q: "a" }, "p-1");
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", "card-1", null);
  });

  it("stops a card it runs", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "stop", payload: { cardId: "card-1" } as never }));
    expect(d.stop).toHaveBeenCalledWith("card-1");
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", "card-1", null);
  });

  it("fails a command that names a card it doesn't have", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "reply", payload: { cardId: "card-9", text: "hi" } as never }));
    expect(d.reply).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That thread isn't on this worker.");
  });

  it("fails a command that names the copilot", async () => {
    const eng = fakeEngine({ "copilot-1": card({ id: "copilot-1", role: "copilot" }) });
    const reg = fakeReg();
    const pub = fakePublisher();
    const daemon = createDaemon({
      reg: reg.reg,
      engine: eng.engine,
      publisher: pub.publisher,
      checkout: vi.fn(),
      login: vi.fn(),
      clone: vi.fn(),
      github: fakeGithub(),
      log: vi.fn(),
    });
    await daemon.runOne(command({ kind: "reply", payload: { cardId: "copilot-1", text: "hi" } as never }));
    expect(reg.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That thread isn't on this worker.");
  });

  it("fails a command it doesn't know", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "explode" as never }));
    expect(d.report).toHaveBeenCalledWith(
      "cmd-1",
      "failed",
      null,
      "This worker doesn't know that kind of request. Update it with weft-worker update.",
    );
  });

  it("fails a new_card with no prompt", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "new_card", payload: { prompt: "" } as never }));
    expect(d.start).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That card has no prompt.");
  });

  // A run with no usable prompt fails; it never falls through to the new-card reader, which doesn't trim.
  it("fails a run whose prompt is blank, without starting a card", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ payload: { prompt: "   " } as never }));
    expect(d.start).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That run has no prompt.");
  });

  it("hands a sealed sign-in to login and reports it done with no card", async () => {
    const d = makeDeps();
    const token = { v: 1, epk: "ZXBr", iv: "aXY=", ct: "Y3Q=", tag: "dGFn" };
    await d.daemon.runOne(command({ kind: "login", folder: "-", payload: { token } as never }));
    expect(d.login).toHaveBeenCalledWith(token);
    expect(d.start).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", null, null);
  });

  it("fails a sign-in that carries no sealed token, or one that won't open", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "login", payload: { token: "sk-ant-plain" } as never }));
    expect(d.login).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That sign-in carries no sealed token.");
    await d.daemon.runOne(command({ kind: "login", payload: null as never }));
    expect(d.report).toHaveBeenLastCalledWith("cmd-1", "failed", null, "That sign-in carries no sealed token.");
    d.login.mockRejectedValueOnce(new Error("Unsupported state or unable to authenticate data"));
    await d.daemon.runOne(command({ kind: "login", payload: { token: { v: 1, epk: "a", iv: "b", ct: "c", tag: "d" } } as never }));
    expect(d.report).toHaveBeenLastCalledWith("cmd-1", "failed", null, "Unsupported state or unable to authenticate data");
  });

  it("fails an empty reply and an empty answer", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "reply", payload: { cardId: "card-1", text: "" } as never }));
    expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That reply is empty.");
    await d.daemon.runOne(command({ kind: "answer", payload: { cardId: "card-1", pendingId: "" } as never }));
    expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That answer is empty.");
  });

  it("fails a stop that names no card", async () => {
    const d = makeDeps();
    await d.daemon.runOne(command({ kind: "stop", payload: {} as never }));
    expect(d.stop).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, "That thread isn't on this worker.");
  });

  it("cuts a long error message to 300 characters", async () => {
    const d = makeDeps();
    d.checkout.mockRejectedValue(new Error("x".repeat(1000)));
    await d.daemon.runOne(command());
    const [id, status, cardId, error] = d.report.mock.calls[0] as [string, string, string | null, string];
    expect(id).toBe("cmd-1");
    expect(status).toBe("failed");
    expect(cardId).toBeNull();
    expect(error).toHaveLength(300);
  });

  it("logs the failure", async () => {
    const d = makeDeps();
    d.checkout.mockRejectedValue(new Error("no disk"));
    await d.daemon.runOne(command());
    expect(d.log).toHaveBeenCalledWith("Weft Worker: run failed: no disk");
  });

  it("doesn't throw when the failure report itself fails", async () => {
    const d = makeDeps();
    d.start.mockRejectedValue(new Error("boom"));
    d.report.mockRejectedValue(new Error("report failed"));
    await expect(d.daemon.runOne(command())).resolves.toBeUndefined();
  });

  it("logs to the console when no logger was given", async () => {
    const reg = fakeReg();
    const eng = fakeEngine();
    const pub = fakePublisher();
    const printed = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const daemon = createDaemon({
        reg: reg.reg,
        engine: eng.engine,
        publisher: pub.publisher,
        checkout: vi.fn(() => Promise.resolve("/srv/work/weft")),
        login: vi.fn(),
        clone: vi.fn(),
        github: fakeGithub(),
      });
      await daemon.runOne(command());
      expect(printed).toHaveBeenCalledWith("Weft Worker: run in weft");
    } finally {
      printed.mockRestore();
    }
  });
});
