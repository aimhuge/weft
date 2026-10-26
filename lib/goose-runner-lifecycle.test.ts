// @vitest-environment node
// The life of a Goose turn: the env and the argv it starts with, the ways it can fail, the files it
// touched, the recipe it writes and the prompt it starts with. The fake `goose run` child and the
// module mocks live in lib/goose-runner.harness.ts, shared with lib/goose-runner.test.ts.
import { describe, expect, it, vi } from "vitest";
import { EXE, setupGoose } from "./goose-runner.harness";
import type { Card } from "./types";

const s = await vi.hoisted(async () => (await import("./goose-runner.harness")).gooseState());

vi.mock("./guards/goose", async () => (await import("./goose-runner.harness")).gooseGuardsMock());
vi.mock("./runner-turn", async () => (await import("./goose-runner.harness")).runnerTurnMock(s));
vi.mock("./store", async () => (await import("./goose-runner.harness")).storeMock(s));
vi.mock("node:child_process", async () => (await import("./goose-runner.harness")).childProcessMock(s));
// The env a Goose turn starts with: the plain one, and one with a var that has no value. Only cliEnv is
// faked; the rest of the module (RESTART_PROMPT) is real, so lib/weft-prompts.ts still loads.
const env = vi.hoisted((): { plain: Record<string, string | undefined> } => ({ plain: { PATH: "/usr/bin" } }));
vi.mock("./env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./env")>()),
  cliEnv: () => ({ ...env.plain }),
}));
// The launch helper hands back how to start Goose with the provider's key in its env. Undefined means
// the plain binary is started, which is what a thread with no provider (or no saved key) gets.
const launch = vi.hoisted(() => ({ value: undefined as Awaited<ReturnType<typeof import("./goose-launch").gooseLaunch>>, argv: [] as string[] }));
vi.mock("./goose-launch", () => ({
  gooseLaunch: (_provider: string, argv: string[]) => {
    launch.argv = argv;
    return Promise.resolve(launch.value);
  },
}));

const rig = setupGoose(s);

const event = (payload: Record<string, unknown>) => JSON.stringify(payload);

describe("the env a Goose turn runs under", () => {
  it("leaves out a var that has no value", () => {
    env.plain = { PATH: "/usr/bin", EMPTY: undefined };
    const r = rig();
    const out = r.goose.gooseEnv(r.session);
    expect(out.PATH).toBe("/usr/bin");
    expect("EMPTY" in out).toBe(false);
    env.plain = { PATH: "/usr/bin" };
  });

  it("leaves out the Claude Code entrypoint, and adds Goose's own", () => {
    const r = rig();
    const out = r.goose.gooseEnv(r.session);
    expect(out.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(out.GOOSE_MODE).toBe("auto");
    expect(out.GOOSE_DISABLE_KEYRING).toBe("1");
  });

  it("points Goose's state at the card's own folder, and leaves it off a spare", () => {
    const r = rig();
    expect(r.goose.gooseEnv(r.session).GOOSE_PATH_ROOT).toContain("goose");
    const spare = { ...r.session, cardId: null };
    expect(r.goose.gooseEnv(spare).GOOSE_PATH_ROOT).toBeUndefined();
  });
});

describe("a turn that fails", () => {
  it("reports Goose's own stderr when the turn ended without a completion", async () => {
    const r = rig();
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    r.child().stderr.write("goose: no provider configured\n");
    r.child().run(s, [], { code: 2 });
    await expect(r.finish(promise)).rejects.toThrow(/no provider configured/);
  });

  it("says what the exit was when Goose said nothing itself", async () => {
    const r = rig();
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    r.child().run(s, [], { code: 3 });
    await expect(r.finish(promise)).rejects.toThrow(/with code 3/);
  });

  it("says what the signal was when Goose was killed", async () => {
    const r = rig();
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    r.child().signalCode = "SIGKILL";
    r.child().run(s, [], { code: null, signal: "SIGKILL" });
    await expect(r.finish(promise)).rejects.toThrow(/on SIGKILL/);
  });

  it("says nothing about the exit when the turn was stopped", async () => {
    const r = rig();
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    r.session.abort.abort();
    r.child().run(s, [], { code: 1 });
    await expect(r.finish(promise)).resolves.toBeUndefined();
  });

  it("reports the error the process failed with", async () => {
    const r = rig();
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    s.errorEvent = "no such binary";
    r.child().run(s, [], { code: 1 });
    await expect(r.finish(promise)).rejects.toThrow(/no such binary/);
  });

  it("says the exit was unknown when the process left no code behind", async () => {
    const r = rig();
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    r.child().run(s, [], { code: null });
    await expect(r.finish(promise)).rejects.toThrow(/with code unknown/);
  });

  it("keeps going when Goose's stdin breaks", async () => {
    const r = rig();
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    r.child().stdin.emit("error", new Error("EPIPE"));
    r.child().run(s, [event({ type: "complete", text: "Done." })]);
    await expect(r.finish(promise)).resolves.toBeUndefined();
  });
});

describe("a spare thread, with no card of its own", () => {
  it("names itself 'spare' when it writes to stderr", async () => {
    const r = rig();
    r.session.cardId = null;
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    r.child().stderr.write("goose: no provider configured\n");
    r.child().run(s, [], { code: 2 });
    await expect(r.finish(promise)).rejects.toThrow(/no provider configured/);
  });
});

describe("a Goose turn started through the launch helper", () => {
  it("runs the grant's binary, and hands it the grant on stdin", async () => {
    launch.value = { bin: "/opt/node", args: ["/opt/goose-env.cjs"], env: { ELECTRON_RUN_AS_NODE: "1" }, stdin: '{"grant":"g"}', names: ["API_KEY"] };
    const r = rig();
    r.session.spec.provider = "anthropic";
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    expect(r.opts().command).toBe("/opt/node");
    expect(r.opts().args).toEqual(["/opt/goose-env.cjs"]);
    expect(r.opts().env.ELECTRON_RUN_AS_NODE).toBe("1");
    // The turn's own env is still there; the helper only adds its own.
    expect(r.opts().env.GOOSE_MODE).toBe("auto");
    // The helper spawns argv[0] as the program, so the Goose binary leads the argv it is handed.
    expect(launch.argv[0]).toBe(EXE);
    expect(launch.argv[1]).toBe("run");
    r.child().run(s, [event({ type: "complete", text: "Done." })]);
    await r.finish(promise);
    launch.value = undefined;
  });

  it("starts the plain binary when the helper has no grant to give", async () => {
    const r = rig();
    r.session.spec.provider = "anthropic";
    launch.value = undefined;
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    expect(r.opts().command).toBe(EXE);
    r.child().run(s, [event({ type: "complete", text: "Done." })]);
    await r.finish(promise);
  });
});

describe("a turn that is aborted before it starts", () => {
  it("never starts a CLI", async () => {
    const r = rig();
    r.session.abort.abort();
    r.session.inbox.push("do it");
    await r.goose.driveGoose(r.session, EXE);
    expect(s.spawned).toHaveLength(0);
  });
});

describe("the files a turn touched", () => {
  it("marks nothing for a session with no card", () => {
    const r = rig();
    r.session.cardId = null;
    r.goose.noteFileChanges(r.session, ["/etc/hosts"]);
    expect(s.cards.get("card-1")?.touchedFiles).toBeUndefined();
  });

  it("marks nothing for a path outside the card's own folder", () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    const r = rig();
    r.goose.noteFileChanges(r.session, ["/etc/hosts"]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual([]);
  });

  it("marks the card's own folder when a note names it", () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    const r = rig();
    r.goose.noteFileChanges(r.session, [r.cwd]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual([r.cwd]);
  });
});

describe("a card whose folder is the root", () => {
  it("marks a file under it", () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    const r = rig();
    r.session.spec.cwd = "/";
    r.goose.noteFileChanges(r.session, ["/etc/hosts"]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual(["/etc/hosts"]);
  });
});

describe("the recipe a turn writes", () => {
  it("reports a recipe that cannot be rendered instead of throwing", async () => {
    const recipe = await import("./goose-recipe");
    const spy = vi.spyOn(recipe, "gooseRecipeYaml").mockImplementation(() => {
      throw new Error("bad plan");
    });
    const r = rig();
    expect(r.goose.saveTurnRecipe(r.session, "do it")).toBe(false);
    spy.mockRestore();
  });
});

describe("the prompt a turn starts with", () => {
  it("is the user's text", () => {
    const r = rig();
    expect(r.goose.promptFor(r.session, "do it")).toBe("do it");
  });
});
