// @vitest-environment node
// The events a Goose turn is made of (a message, a progress note, an error, the end of the turn), the
// text each of them carries, and the way each one is filed on the thread. The fake `goose run` child
// and the module mocks live in lib/goose-runner.harness.ts, shared with lib/goose-runner.test.ts.
import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { setupGoose } from "./goose-runner.harness";

const s = await vi.hoisted(async () => (await import("./goose-runner.harness")).gooseState());

vi.mock("./runner-turn", async () => (await import("./goose-runner.harness")).runnerTurnMock(s));
vi.mock("./store", async () => (await import("./goose-runner.harness")).storeMock(s));
vi.mock("node:child_process", async () => (await import("./goose-runner.harness")).childProcessMock(s));
// The env a Goose turn starts with: the plain one, and one with a var that has no value. Only cliEnv is
// faked; the rest of the module (RESTART_PROMPT) is real, so lib/weft-prompts.ts still loads.
const env = vi.hoisted(() => ({ plain: { PATH: "/usr/bin" } }));
vi.mock("./env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./env")>()),
  cliEnv: () => ({ ...env.plain }),
}));

const rig = setupGoose(s);

/** The assistant text of every message handle() saw. */
const texts = () =>
  s.handled.flatMap((h) => (h.msg.message as { content?: { text?: string }[] } | undefined)?.content ?? []).flatMap((c) => (c.text ? [c.text] : []));
const results = () => s.handled.filter((h) => h.msg.type === "result").map((h) => h.msg);
const event = (payload: Record<string, unknown>) => JSON.stringify(payload);

describe("a Goose event's text", () => {
  it("is the message, the error, the completion or the progress note", () => {
    const r = rig();
    expect(r.goose.eventText({ kind: "message", text: "Hello." })).toBe("Hello.");
    expect(r.goose.eventText({ kind: "error", message: "Boom." })).toBe("Boom.");
    expect(r.goose.eventText({ kind: "complete", text: "Done." })).toBe("Done.");
    expect(r.goose.eventText({ kind: "notification", progress: "Running." })).toBe("Running.");
    expect(r.goose.eventText({ kind: "unknown", type: "noise" })).toBe("");
  });

  it("ends the turn on a completion and on nothing else", () => {
    const r = rig();
    expect(r.goose.isTurnEnd({ kind: "complete", text: "Done." })).toBe(true);
    expect(r.goose.isTurnEnd({ kind: "message", text: "Hello." })).toBe(false);
    expect(r.goose.isTurnEnd(null)).toBe(false);
  });
});

describe("a tool row for a progress note", () => {
  it("is named Goose, and there is none for any other event", () => {
    const r = rig();
    expect(r.goose.gooseToolUse({ kind: "notification", progress: "Running." })).toEqual({ name: "Goose", input: { progress: "Running." } });
    expect(r.goose.gooseToolUse({ kind: "message", text: "Hello." })).toBeNull();
  });

  it("carries the error when there is one, and the progress when there isn't", () => {
    const r = rig();
    expect(r.goose.gooseToolResult("Running.")).toEqual({ result: "Running.", isError: false });
    expect(r.goose.gooseToolResult("Running.", "Boom.")).toEqual({ result: "Boom.", isError: true });
  });
});

describe("the model a Goose thread's rows are filed under", () => {
  it("is the card's own model, and 'Goose' on the default", () => {
    const r = rig();
    expect(r.goose.modelName({ ...r.session, spec: { ...r.session.spec, model: "openai/gpt-4.1" } })).toBe("openai/gpt-4.1");
    expect(r.goose.modelName(r.session)).toBe("Goose");
    expect(r.goose.modelName({ ...r.session, spec: { ...r.session.spec, model: "goose-default" } })).toBe("Goose");
  });
});

describe("a message's text", () => {
  it("is the content when it is a string", () => {
    const r = rig();
    expect(r.goose.messageText({ message: { content: "Hello." } })).toBe("Hello.");
  });

  it("is nothing when the content isn't a string or a list", () => {
    const r = rig();
    expect(r.goose.messageText({ message: { content: 42 } })).toBe("");
    expect(r.goose.messageText({ message: {} })).toBe("");
    expect(r.goose.messageText({})).toBe("");
  });

  it("joins the parts it can read, and drops the ones it can't", () => {
    const r = rig();
    expect(r.goose.messageText({ message: { content: [{ text: "one" }, { text: "two" }] } })).toBe("one\ntwo");
    expect(r.goose.messageText({ message: { content: [{ text: 42 }, { text: true }] } })).toBe("42\ntrue");
    // A part with no text, a part that isn't an object, and one whose text is an object: all dropped.
    expect(r.goose.messageText({ message: { content: [{}, null, "plain", { text: { a: 1 } }] } })).toBe("\n\n\n");
  });
});

describe("the events a turn is made of", () => {
  it("ends the turn on an error, and files the error as the result", async () => {
    await rig().run([event({ type: "error", error: "Boom." })]);
    const [result] = results();
    expect(result).toMatchObject({ subtype: "error_execution", is_error: true, result: "Boom." });
  });

  it("ends the turn on a completion, with the text Goose finished with", async () => {
    await rig().run([event({ type: "complete", text: "All done." })]);
    expect(results()[0]).toMatchObject({ subtype: "success", is_error: false, result: "All done." });
  });

  it("says 'Done.' when a completion carries no text", async () => {
    await rig().run([event({ type: "complete" })]);
    expect(results()[0]).toMatchObject({ result: "Done." });
  });

  it("shows a message with no text as nothing at all", async () => {
    await rig().run([event({ type: "message", message: "" })]);
    expect(texts()).toEqual([]);
    expect(results()).toHaveLength(1);
  });

  it("shows a progress note once, and not again under the same name", async () => {
    const r = rig();
    await r.run([event({ type: "notification", progress: "Running the tests" }), event({ type: "notification", progress: "Running the tests" })]);
    const notes = s.handled.filter((h) => h.msg.type === "assistant").map((h) => (h.msg.message as { content: { type: string }[] }).content);
    expect(notes.flat().filter((b) => b.type === "tool_use")).toHaveLength(1);
  });

  it("ignores a kind Weft doesn't act on", async () => {
    await rig().run([event({ type: "status", text: "noise" })]);
    expect(texts()).toEqual([]);
    expect(results()).toHaveLength(1);
  });

  it("files nothing for a session with no card", async () => {
    const r = rig();
    r.session.cardId = null;
    await r.run([event({ type: "complete", text: "All done." })]);
    expect(results()).toHaveLength(0);
  });
});

describe("an event applied to the thread", () => {
  it("shows a message with text, and doesn't end the turn", async () => {
    const r = rig();
    expect(await r.goose.handleGooseEvent(r.session, { kind: "message", text: "Hello." })).toBe(false);
    expect(texts()).toEqual(["Hello."]);
  });

  it("shows nothing for a message with no text, and doesn't end the turn", async () => {
    const r = rig();
    expect(await r.goose.handleGooseEvent(r.session, { kind: "message", text: "" })).toBe(false);
    expect(texts()).toEqual([]);
  });

  it("shows a progress note as a tool row, and doesn't end the turn", async () => {
    const r = rig();
    expect(await r.goose.handleGooseEvent(r.session, { kind: "notification", progress: "Running." })).toBe(false);
    expect(s.handled.filter((h) => h.msg.type === "assistant")).toHaveLength(1);
  });

  it("shows nothing for a progress note with no name to file it under", async () => {
    const r = rig();
    expect(await r.goose.handleGooseEvent(r.session, { kind: "notification", progress: "" })).toBe(false);
    expect(s.handled.filter((h) => h.msg.type === "assistant")).toHaveLength(0);
  });

  it("ends the turn on an error, and on a completion", async () => {
    const r = rig();
    expect(await r.goose.handleGooseEvent(r.session, { kind: "error", message: "Boom." })).toBe(true);
    expect(await r.goose.handleGooseEvent(r.session, { kind: "complete", text: "Done." })).toBe(true);
  });

  it("does nothing with a kind Weft doesn't act on", async () => {
    const r = rig();
    expect(await r.goose.handleGooseEvent(r.session, { kind: "unknown", type: "status" })).toBe(false);
    expect(s.handled).toHaveLength(0);
  });
});

describe("the events on Goose's stdout", () => {
  it("skips a blank line and one that isn't JSON, and ends the turn on a completion", async () => {
    const r = rig();
    const stdout = new PassThrough();
    stdout.write("   \n");
    stdout.write("not json\n");
    stdout.write(`${event({ type: "complete", text: "Done." })}\n`);
    stdout.end();
    expect(await r.goose.readGooseEvents(r.session, stdout)).toBe(true);
    expect(results()).toHaveLength(1);
  });

  it("says the turn didn't end when Goose's stream had no completion", async () => {
    const r = rig();
    const stdout = new PassThrough();
    stdout.write(`${event({ type: "message", message: "Hi." })}\n`);
    stdout.end();
    expect(await r.goose.readGooseEvents(r.session, stdout)).toBe(false);
  });
});

describe("a turn Goose ends without a word on stderr", () => {
  it("fails with the plain-text error Goose printed on stdout, without its banner", async () => {
    const r = rig();
    const lines = ["    __( O)>  ● new session · anthropic puku-ai-2.8", "     L L     goose is ready", "  error: Error Configuration value not found: ANTHROPIC_API_KEY.", "Please check your system keychain."];
    const error = await r.start(lines, { code: 1 }).then(() => null, (err: unknown) => err as Error);
    expect(error?.message).toBe("error: Error Configuration value not found: ANTHROPIC_API_KEY.\nPlease check your system keychain.");
  });

  it("falls back to the exit code when Goose printed nothing", async () => {
    const r = rig();
    await expect(r.start([], { code: 1 })).rejects.toThrow("Goose exited with code 1 without finishing the turn.");
  });
});

describe("a reply Goose 1.x streams in slices", () => {
  const slice = (id: string, text: string) => event({ type: "message", message: { id, role: "assistant", content: [{ type: "text", text }] } });

  it("files each reply once, whole, and ends the turn with the last one", async () => {
    const r = rig();
    await r.run([slice("a", "Hi"), slice("a", " there."), event({ type: "notification", progress: "reading" }), slice("b", "Now "), slice("b", "done."), event({ type: "complete", total_tokens: 10 })]);
    expect(texts()).toEqual(["Hi there.", "Now done."]);
    expect(results().map((m) => m.result)).toEqual(["Now done."]);
  });

  it("files a reply as soon as the next one starts", async () => {
    const r = rig();
    await r.run([slice("a", "First."), slice("b", "Second."), event({ type: "complete" })]);
    expect(texts()).toEqual(["First.", "Second."]);
  });

  it("still files what Goose said when the stream ends mid-reply", async () => {
    const r = rig();
    const error = await r.start([slice("a", "Partial")], { code: 1 }).then(() => null, (err: unknown) => err as Error);
    expect(error?.message).toContain("exited with code 1");
    expect(texts()).toEqual(["Partial"]);
  });

  it("files an older Goose's whole messages one by one", async () => {
    const r = rig();
    await r.run([event({ type: "message", message: "One." }), event({ type: "message", message: "Two." }), event({ type: "complete" })]);
    expect(texts()).toEqual(["One.", "Two."]);
    expect(results().map((m) => m.result)).toEqual(["Two."]);
  });
});
