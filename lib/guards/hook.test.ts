import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../runner-state";
import type { GuardCall } from "./decide";

// One hook call from a Codex, Goose or Antigravity turn: read in Claude Code's terms, run through the turn's guards (mocked here:
// decide.ts and ask.ts have their own tests), and answered in the CLI's words. Anything that goes wrong refuses.

const decide = vi.fn<(...a: unknown[]) => unknown>();
const askAboutCall = vi.fn<(...a: unknown[]) => unknown>();
const guardTurn = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("./decide", () => ({ decide: (...a: unknown[]) => decide(...a) }));
vi.mock("./ask", () => ({ askAboutCall: (...a: unknown[]) => askAboutCall(...a) }));
vi.mock("./turn", () => ({ guardTurn: (...a: unknown[]) => guardTurn(...a) }));

const { answerHook, ASK_LIMIT_MS, isGuardCli, isGuardEvent } = await import("./hook");
const { bindConversation, takeNotes } = await import("./antigravity-turns");

const session = { cardId: "c", abort: new AbortController() } as unknown as Session;
const turn = { session, hooks: {} };
const signal = () => new AbortController().signal;
const bash = (event = "PreToolUse", extra: Record<string, unknown> = {}) => ({ hook_event_name: event, tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "t1", cwd: "/w", ...extra });
const twoFiles = { hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Add File: /w/a\n+x\n*** Add File: /w/b\n+y\n*** End Patch" }, tool_use_id: "p", cwd: "/w" };

beforeEach(() => {
  decide.mockReset();
  askAboutCall.mockReset();
  guardTurn.mockReset().mockReturnValue(turn);
});

describe("isGuardCli and isGuardEvent", () => {
  it("know Codex and Goose, and the three events the guards answer", () => {
    expect([isGuardCli("codex"), isGuardCli("goose"), isGuardCli("antigravity"), isGuardCli("claude")]).toEqual([true, true, true, false]);
    expect(["PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"].map(isGuardEvent)).toEqual([true, true, true, false]);
  });
});

describe("answerHook", () => {
  it("is null for a token that names no open turn", async () => {
    guardTurn.mockReturnValue(undefined);
    expect(await answerHook("codex", "PreToolUse", "nope", bash(), signal())).toBeNull();
  });

  it("lets a call through when every guard allows it", async () => {
    decide.mockResolvedValue({ decision: "allow" });
    const out = await answerHook("codex", "PreToolUse", "t", bash(), signal());
    expect(JSON.stringify(out)).not.toContain("deny");
    expect(decide.mock.calls[0]?.[1]).toMatchObject({ tool: "Bash", input: { command: "ls" }, id: "t1" });
  });

  it("refuses a denied call with the guard's reason, in Goose's words", async () => {
    decide.mockResolvedValue({ decision: "deny", reason: "No .env reads." });
    const out = await answerHook("goose", "PreToolUse", "t", { event: "PreToolUse", tool_name: "shell", tool_input: { command: "cat .env" }, working_dir: "/w" }, signal());
    expect(out).toEqual({ decision: "block", reason: "No .env reads." });
  });

  it("checks each file of a patch, and stops at the first one refused", async () => {
    decide.mockResolvedValueOnce({ decision: "allow" }).mockResolvedValueOnce({ decision: "deny", reason: "b is outside" });
    expect(JSON.stringify(await answerHook("codex", "PreToolUse", "t", twoFiles, signal()))).toContain("b is outside");
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("asks you about an ask, within the hour the CLI's hook waits, and lets the call through on yes", async () => {
    decide.mockResolvedValue({ decision: "ask", reason: "Outside the folder?" });
    askAboutCall.mockResolvedValue({ behavior: "allow", updatedInput: {} });
    const out = await answerHook("codex", "PreToolUse", "t", bash(), signal());
    expect(JSON.stringify(out)).not.toContain("deny");
    const [s, tool, , id, , title] = (askAboutCall.mock.calls[0] ?? []);
    expect([s, tool, id, title]).toEqual([session, "Bash", "t1", "Outside the folder?"]);
    expect(ASK_LIMIT_MS).toBeLessThan(60 * 60_000);
  });

  it("refuses an ask you turned down, with your words or Weft's", async () => {
    decide.mockResolvedValue({ decision: "ask" });
    askAboutCall.mockResolvedValueOnce({ behavior: "deny", message: "not now" }).mockResolvedValueOnce({ behavior: "deny", message: "" });
    expect(JSON.stringify(await answerHook("codex", "PreToolUse", "t", bash(), signal()))).toContain("not now");
    expect(JSON.stringify(await answerHook("codex", "PreToolUse", "t", bash(), signal()))).toContain("Denied in Weft.");
  });

  it("gives a call that came without an id one, so the folder gate can ask about it", async () => {
    decide.mockResolvedValue({ decision: "allow" });
    await answerHook("codex", "PreToolUse", "t", bash("PreToolUse", { tool_use_id: undefined }), signal());
    expect((decide.mock.calls[0]?.[1] as GuardCall | undefined)?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("after a call, passes on the guards' context and feedback, and nothing when they have none", async () => {
    decide
      .mockResolvedValueOnce({ decision: "allow", context: "Broke an import.", feedback: "Fix it." })
      .mockResolvedValueOnce({ decision: "allow", context: "And b." })
      .mockResolvedValueOnce({ decision: "deny", reason: "ignored after the call" });
    const patch = { ...twoFiles, hook_event_name: "PostToolUse", tool_response: "ok" };
    const out = JSON.stringify(await answerHook("codex", "PostToolUse", "t", patch, signal()));
    expect(out).toContain("Broke an import.\\n\\nAnd b.");
    expect(out).toContain("Fix it.");
    decide.mockResolvedValue({ decision: "allow" });
    expect(JSON.stringify(await answerHook("codex", "PostToolUse", "t", bash("PostToolUse"), signal()))).not.toMatch(/additionalContext|reason/);
    expect(await answerHook("goose", "PostToolUse", "t", { event: "PostToolUse", tool_name: "shell", tool_input: { command: "ls" }, working_dir: "/w" }, signal())).toEqual({ decision: "allow" });
  });

  it("refuses a call whose guard threw, and lets a finished one stand", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    decide.mockRejectedValue(new Error("boom"));
    expect(JSON.stringify(await answerHook("codex", "PreToolUse", "t", bash(), signal()))).toContain("Weft's guards failed on this call (boom)");
    decide.mockRejectedValue("bare");
    expect(await answerHook("goose", "PreToolUse", "t", { event: "PreToolUse", tool_name: "shell", tool_input: { command: "ls" }, working_dir: "/w" }, signal())).toMatchObject({ decision: "block", reason: expect.stringContaining("(bare)") as string });
    expect(await answerHook("goose", "PostToolUse", "t", { event: "PostToolUse", tool_name: "shell", tool_input: { command: "ls" }, working_dir: "/w" }, signal())).toEqual({ decision: "allow" });
    error.mockRestore();
  });
});

describe("answerHook on Antigravity", () => {
  // agy 1.5.16's PreToolUse payload, as its hooks.json command posts it: no token, a conversation id.
  const payload = (over: Record<string, unknown> = {}) => ({ conversationId: "C", cwd: "/tmp/p", hookEventName: "PreToolUse", stepIdx: 2, toolCall: { args: { Path: "/tmp/p/x.txt" }, id: "call_9", name: "read_file" }, workspacePaths: ["/tmp/p"], ...over });

  it("finds the turn from the payload's conversation when the hook sent no token", async () => {
    const unbind = bindConversation("C", "agy-token");
    decide.mockResolvedValue({ decision: "allow" });
    expect(await answerHook("antigravity", "PreToolUse", undefined, payload(), signal())).toEqual({ decision: "allow" });
    expect(guardTurn).toHaveBeenCalledWith("agy-token", "antigravity");
    expect(decide.mock.calls[0]?.[1]).toEqual({ event: "PreToolUse", tool: "Read", input: { file_path: "/tmp/p/x.txt" }, cwd: "/tmp/p", id: "call_9" });
    unbind();
  });

  it("looks up no turn for a conversation Weft didn't start, and prefers a token when there is one", async () => {
    guardTurn.mockReturnValue(undefined);
    expect(await answerHook("antigravity", "PreToolUse", undefined, payload({ conversationId: "other" }), signal())).toBeNull();
    expect(guardTurn).toHaveBeenLastCalledWith(undefined, "antigravity");
    await answerHook("antigravity", "PreToolUse", "bearer", payload(), signal());
    expect(guardTurn).toHaveBeenLastCalledWith("bearer", "antigravity");
  });

  it("never reads a conversation for another CLI's hook without a token", async () => {
    const unbind = bindConversation("C", "agy-token");
    guardTurn.mockReturnValue(undefined);
    await answerHook("codex", "PreToolUse", undefined, payload(), signal());
    expect(guardTurn).toHaveBeenLastCalledWith(undefined, "codex");
    unbind();
  });

  it("refuses a denied call in agy's words, and says nothing after one", async () => {
    decide.mockResolvedValue({ decision: "deny", reason: "No .env reads." });
    expect(await answerHook("antigravity", "PreToolUse", "t", payload(), signal())).toEqual({ decision: "deny", reason: "No .env reads." });
    decide.mockResolvedValue({ decision: "allow", context: "c" });
    expect(await answerHook("antigravity", "PostToolUse", "t", payload({ hookEventName: "PostToolUse" }), signal())).toEqual({});
  });

  it("keeps what the guards said after a call for agy's next model call, feedback first", async () => {
    const unbind = bindConversation("C", "agy-token");
    decide.mockResolvedValue({ decision: "allow", context: "Broke an import.", feedback: "Fix it." });
    expect(await answerHook("antigravity", "PostToolUse", undefined, payload({ hookEventName: "PostToolUse" }), signal())).toEqual({});
    expect(takeNotes({ conversationId: "C" })).toEqual({ injectSteps: [{ systemMessage: { systemMessage: "Fix it.\n\nBroke an import." } }] });
    // Nothing to say keeps nothing.
    decide.mockResolvedValue({ decision: "allow" });
    await answerHook("antigravity", "PostToolUse", undefined, payload({ hookEventName: "PostToolUse" }), signal());
    await answerHook("antigravity", "PreToolUse", undefined, payload(), signal());
    expect(takeNotes({ conversationId: "C" })).toEqual({});
    unbind();
  });

  it("keeps no note for a refused call, nor for another CLI's after-call answer", async () => {
    const unbind = bindConversation("C", "agy-token");
    decide.mockResolvedValue({ decision: "deny", reason: "No .env reads." });
    await answerHook("antigravity", "PreToolUse", undefined, payload(), signal());
    decide.mockResolvedValue({ decision: "allow", context: "codex context" });
    await answerHook("codex", "PostToolUse", "t", { ...bash("PostToolUse"), conversationId: "C" }, signal());
    expect(takeNotes({ conversationId: "C" })).toEqual({});
    unbind();
  });
});
