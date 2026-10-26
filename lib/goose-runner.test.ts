// @vitest-environment node
// Drive lib/goose-runner.ts's turn loop against a fake `goose run` child: what argv/env it is started with,
// what its JSON event stream becomes in the card's thread, the recipe it writes beside the turn, and the
// files a progress note marks on the card.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EXE, setupGoose } from "./goose-runner.harness";
import type { Card } from "./types";

const s = await vi.hoisted(async () => (await import("./goose-runner.harness")).gooseState());

vi.mock("./guards/goose", async () => (await import("./goose-runner.harness")).gooseGuardsMock());
vi.mock("./runner-turn", async () => (await import("./goose-runner.harness")).runnerTurnMock(s));
vi.mock("./store", async () => (await import("./goose-runner.harness")).storeMock(s));
vi.mock("node:child_process", async () => (await import("./goose-runner.harness")).childProcessMock(s));

const rig = setupGoose(s);

/** The non-text blocks of every assistant message handle() saw. */
const blocks = () =>
  s.handled.flatMap((h) => (h.msg.message as { content?: { type: string }[] } | undefined)?.content ?? []).filter((b) => b.type !== "text");
const results = () => s.handled.filter((h) => h.msg.type === "result").map((h) => h.msg);
const event = (payload: Record<string, unknown>) => JSON.stringify(payload);

describe("driveGoose starts goose run", () => {
  it("reads the turn's events off stdout and ends the turn on a complete event", async () => {
    await rig().run([event({ type: "message", message: "Hello." })]);
    expect(rig().opts()).toMatchObject({ command: EXE, cwd: rig().cwd });
    expect(rig().opts().args.slice(0, 4)).toEqual(["run", "--output-format", "stream-json", "--max-turns"]);
    expect(results()).toHaveLength(1);
  });

  it("points Goose's own state at the card's folder under Weft's data dir", async () => {
    await rig().run([]);
    expect(rig().opts().env.GOOSE_PATH_ROOT).toContain("goose");
    expect(rig().opts().env.GOOSE_MODE).toBe("auto");
    expect(rig().opts().env.GOOSE_DISABLE_KEYRING).toBe("1");
  });

  it("runs every turn behind Weft's guards and closes them after", async () => {
    const closed = vi.fn();
    const { openGooseGuards } = await import("./guards/goose");
    vi.mocked(openGooseGuards).mockReturnValueOnce(closed);
    await rig().run([]);
    expect(openGooseGuards).toHaveBeenCalledWith(rig().session);
    expect(closed).toHaveBeenCalled();
  });

  it("refuses to start a turn whose guards can't be installed, and says why", async () => {
    const { openGooseGuards } = await import("./guards/goose");
    vi.mocked(openGooseGuards).mockImplementationOnce(() => {
      throw new Error("Weft didn't start this turn: its guards couldn't be installed (no port).");
    });
    const r = rig();
    const turn = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await expect(turn).rejects.toThrow("guards couldn't be installed");
    expect(s.spawned).toHaveLength(0);
  });

  it("stops before starting a turn once the session is aborted", async () => {
    const r = rig();
    r.session.abort.abort();
    r.session.inbox.push("do it");
    await r.goose.driveGoose(r.session, EXE);
    expect(s.spawned).toHaveLength(0);
  });
});

describe("the turn's recipe on disk", () => {
  it("writes the recipe before Goose is started", async () => {
    const r = rig();
    const promise = r.goose.driveGoose(r.session, EXE);
    r.session.inbox.push("do it");
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    const recipe = await import("./goose-recipe-store");
    expect(recipe.readRecipe("card-1")).toContain("prompt:");
    r.child().run(s, [event({ type: "complete", text: "Done." })]);
    await r.finish(promise);
  });
  it("writes the recipe under the card's own Goose state root, not in the project folder", async () => {
    await rig().run([]);
    const recipe = await import("./goose-recipe-store");
    const file = recipe.recipeFile("card-1");
    expect(file).toContain("goose");
    expect(file).not.toContain(rig().cwd);
  });

  it("writes a recipe that holds the prompt the turn ran with", async () => {
    await rig().run([]);
    const recipe = await import("./goose-recipe-store");
    const written = recipe.readRecipe("card-1");
    expect(written).toContain("do it");
    // The recipe is a recipe Weft wrote, so the optimizer can read it back.
    const { parseRecipe } = await import("./harness-recipe");
    expect(parseRecipe(written)).not.toBeNull();
  });

  it("writes the recipe from the same plan the argv is built from", async () => {
    const r = rig();
    r.session.spec.model = "anthropic/claude-sonnet-4";
    await r.run([]);
    const recipe = await import("./goose-recipe-store");
    const written = recipe.readRecipe("card-1");
    expect(written).toContain("anthropic/claude-sonnet-4");
    expect(r.opts().args).toContain("--model");
    expect(r.opts().args[r.opts().args.indexOf("--model") + 1]).toBe("anthropic/claude-sonnet-4");
  });

  it("resumes the card's Goose session once it has one, so a turn remembers the thread", async () => {
    const { gooseStateRoot } = await import("./goose-state");
    const sessions = path.join(gooseStateRoot("card-1"), "data", "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, "sessions.db"), "");
    const r = rig();
    await r.run([]);
    expect(r.opts().args).toContain("--resume");
  });

  it("opens a new session with Weft's instructions in the message when Puku's gateway drops the system prompt", async () => {
    const r = rig();
    r.session.spec.gooseBaseUrl = "https://api-cli.puku.sh";
    await r.run([]);
    const args = r.opts().args;
    expect(args[args.indexOf("--text") + 1]).toMatch(/^<weft-instructions>/);
  });

  it("starts a new Goose session on the card's first turn", async () => {
    const r = rig();
    await r.run([]);
    expect(r.opts().args).not.toContain("--resume");
  });

  it("runs the turn even when the recipe cannot be written", async () => {
    const r = rig();
    const recipe = await import("./goose-recipe-store");
    const spy = vi.spyOn(recipe, "writeRecipe").mockReturnValue(false);
    await r.run([event({ type: "message", message: "Still ran." })]);
    expect(spy).toHaveBeenCalled();
    expect(results()).toHaveLength(1);
    spy.mockRestore();
  });

  it("writes no recipe for a session with no card", () => {
    const r = rig();
    r.session.cardId = null;
    expect(r.goose.saveTurnRecipe(r.session, "do it")).toBe(false);
  });

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

describe("the files a Goose turn touched", () => {
  it("marks the file a progress note names on the card, as an absolute path", async () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    await rig().run([event({ type: "notification", progress: "Wrote src/foo.ts (42 lines)" })]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual([`${rig().cwd}/src/foo.ts`]);
  });

  it("marks the file an edit note names", async () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    await rig().run([event({ type: "notification", progress: "Edited lib/a.ts (10 lines -> 12 lines)" })]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual([`${rig().cwd}/lib/a.ts`]);
  });

  it("marks nothing for a progress note that names no file", async () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    await rig().run([event({ type: "notification", progress: "Running the tests" })]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual([]);
  });

  it("marks nothing for a file outside the card's own folder", async () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    await rig().run([event({ type: "notification", progress: "Wrote /etc/hosts (1 lines)" })]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual([]);
  });

  it("marks nothing for a relative path that climbs out of the card's folder", async () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    await rig().run([event({ type: "notification", progress: "Wrote ../elsewhere/a.ts (1 lines)" })]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual([]);
  });

  it("marks nothing on a notification for a session with no card", async () => {
    rig().session.cardId = null;
    await rig().run([event({ type: "notification", progress: "Wrote src/foo.ts (1 lines)" })]);
    expect(s.cards.get("card-1")?.touchedFiles).toBeUndefined();
  });

  it("marks the card's own folder when a note names it", () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    const r = rig();
    r.goose.noteFileChanges(r.session, [r.cwd]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual([r.cwd]);
  });

  it("marks nothing for an empty path", () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    const r = rig();
    r.goose.noteFileChanges(r.session, [""]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual([]);
  });

  it("marks nothing on a note for a session with no card", () => {
    const r = rig();
    r.session.cardId = null;
    r.goose.noteFileChanges(r.session, ["a.ts"]);
    expect(s.cards.get("card-1")?.touchedFiles).toBeUndefined();
  });
});

describe("Goose events become thread items", () => {
  it("shows a notification as a tool row named Goose", async () => {
    await rig().run([event({ type: "notification", progress: "Running the tests" })]);
    expect(blocks()).toEqual([expect.objectContaining({ type: "tool_use", name: "Goose", input: { progress: "Running the tests" } })]);
  });

  it("puts an assistant message's text in the thread", async () => {
    await rig().run([event({ type: "message", message: "All done." })]);
    const texts = s.handled.flatMap((h) => (h.msg.message as { content?: { text?: string }[] } | undefined)?.content ?? []).flatMap((c) => (c.text ? [c.text] : []));
    expect(texts).toEqual(["All done."]);
  });

  it("skips a blank line and one that isn't JSON", async () => {
    await rig().run(["   ", "not json"]);
    expect(results()).toHaveLength(1);
  });
});

// A subagent the thread starts with a bare `goose run` inherits the thread's provider and model through
// Goose's own config vars; its commits are signed through the system text, since Goose has no attribution setting.
describe("what a Goose thread passes on", () => {
  it("puts the thread's provider and model in GOOSE_PROVIDER and GOOSE_MODEL", () => {
    const r = rig();
    const env = r.goose.gooseEnv({ ...r.session, spec: { ...r.session.spec, provider: "anthropic", model: "puku-ai-2.8" } });
    expect(env).toMatchObject({ GOOSE_PROVIDER: "anthropic", GOOSE_MODEL: "puku-ai-2.8" });
    const bare = r.goose.gooseEnv(r.session);
    expect(bare.GOOSE_PROVIDER).toBeUndefined();
    expect(bare.GOOSE_MODEL).toBeUndefined();
  });

  it("tells the thread how to sign its commits, and its subagents to run as goose run", () => {
    const r = rig();
    const args = r.goose.argsFor({ ...r.session, spec: { ...r.session.spec, model: "openai/gpt-4.1" } }, "hi");
    const system = args[args.indexOf("--system") + 1];
    expect(system).toContain("Co-Authored-By: Goose (openai/gpt-4.1) on Weft <noreply@weft.zip>");
    expect(system).toContain('goose run --text "<self-contained task>"');
  });

  it("gives the copilot no commit lines", () => {
    const r = rig();
    const args = r.goose.argsFor({ ...r.session, spec: { ...r.session.spec, copilot: true } }, "hi");
    expect(args[args.indexOf("--system") + 1]).not.toContain("Co-Authored-By");
  });
});
