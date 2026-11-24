import { describe, expect, it, vi } from "vitest";
import { CWD, EXE, makeSession, type FakeAgy, type Rpc } from "./antigravity-runner.harness";
import type { Card } from "./types";

// One Antigravity turn (lib/antigravity-runner.ts runAgyTurn, answerPermission, agyLabel) against a fake agy that
// streams the session/update lines agy 1.5.16 really writes, asks before a call, and answers session/prompt.

const s = vi.hoisted(() => ({}) as import("./antigravity-runner.harness").State);
vi.mock("node:child_process", async () => (await import("./antigravity-runner.harness")).childProcessMock(s));
vi.mock("./runner-turn", async () => (await import("./antigravity-runner.harness")).runnerTurnMock(s));
vi.mock("./store", async () => (await import("./antigravity-runner.harness")).storeMock(s));
vi.mock("./guards/antigravity", async () => (await import("./antigravity-runner.harness")).guardsMock());
vi.mock("./antigravity-mcp", async () => (await import("./antigravity-runner.harness")).mcpMock());
vi.mock("./antigravity-models", async () => (await import("./antigravity-runner.harness")).modelsMock());
vi.mock("./guards/ask", () => ({ askAboutCall: vi.fn() }));
vi.mock("./bus", () => ({ publish: (event: unknown) => void s.published.push(event) }));
vi.mock("./env", () => ({ cliEnv: () => ({ PATH: "/usr/bin" }) }));
vi.mock("./secret-run", () => ({ redactStored: (_c: string, t: string) => Promise.resolve(t) }));
vi.mock("./overlap", () => ({ touchFile: (list: string[] | undefined, f: string) => [...(list ?? []), f] }));
vi.mock("./weft-prompts", async () => (await import("./antigravity-runner.harness")).promptDepsMocks.weftPrompts());
vi.mock("./puku-context", async () => (await import("./antigravity-runner.harness")).promptDepsMocks.pukuContext());
vi.mock("./skills", async () => (await import("./antigravity-runner.harness")).promptDepsMocks.skills());

const { agyState, setupAgy } = await import("./antigravity-runner.harness");
Object.assign(s, agyState());
const rig = setupAgy(s);
const agy = await import("./antigravity-runner");
const { askAboutCall } = await import("./guards/ask");

// agy 1.5.16's own lines, verbatim.
const L = {
  runStart: '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call","toolCallId":"call_1","name":"run_command","args":{"CommandLine":"echo hello_weft","WaitMsBeforeAsync":5000,"toolSummary":"Echo hello weft"},"status":"in_progress","kind":"execute","title":"echo hello_weft","rawInput":{"CommandLine":"echo hello_weft","WaitMsBeforeAsync":5000,"toolSummary":"Echo hello weft"}}}}',
  permission: '{"jsonrpc":"2.0","method":"session/request_permission","params":{"sessionId":"S","toolCall":{"toolCallId":"call_1","name":"run_command","rawInput":{"CommandLine":"echo hello_weft"},"title":"echo hello_weft"},"options":[{"optionId":"allow","name":"Allow","kind":"allow_once"},{"optionId":"deny","name":"Deny","kind":"reject_once"}]},"id":"1"}',
  runEnd: '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_1","name":"run_command","status":"completed","kind":"execute","rawInput":{"CommandLine":"echo hello_weft"},"rawOutput":{"output":"Command output:\\nhello_weft\\r\\n","exit_code":0},"content":[{"type":"content","content":{"type":"text","text":"Command output:\\nhello_weft\\r\\n"}}]}}}',
  writeStart: '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call","toolCallId":"call_2","name":"write_file","args":{"Content":"a","Overwrite":true,"Path":"/tmp/p/x.txt"},"status":"in_progress","kind":"edit","title":"File x.txt","locations":[{"path":"/tmp/p/x.txt"}],"rawInput":{"Content":"a","Overwrite":true,"Path":"/tmp/p/x.txt"}}}}',
  writeEnd: '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_2","name":"write_file","status":"completed","kind":"edit","locations":[{"path":"/tmp/p/x.txt"}],"rawInput":{"Content":"a","Overwrite":true,"Path":"/tmp/p/x.txt"},"rawOutput":{},"content":[{"type":"diff","path":"/tmp/p/x.txt","newText":"a"}]}}}',
  readDenied: '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_3","name":"read_file","status":"failed","kind":"read","rawInput":{"Path":"/tmp/p/x.txt"},"rawOutput":"tool call denied by pre-tool hook: Weft guard: blocked","content":[{"type":"content","content":{"type":"text","text":"tool call denied by pre-tool hook: Weft guard: blocked"}}]}}}',
  mcpStart: '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call","toolCallId":"call_4","name":"mcp_browser_open_url","args":{"url":"x","toolSummary":"open"},"status":"in_progress","kind":"other","rawInput":{"url":"x","toolSummary":"open"}}}}',
  chunk: '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Executed the echo command."}}}}',
  usage: '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"usage_update","used":15082,"size":1048576}}}',
};
const USAGE = { inputTokens: 17008, outputTokens: 511, cachedReadTokens: 12355, cachedWriteTokens: 0, thoughtTokens: 411, totalTokens: 29874 };
const chunk = (text: string) => L.chunk.replace("Executed the echo command.", text);

// A user message as the inbox queues it (lib/runner-state.ts Inbox, whose import graph is too wide to load here).
function message(text: string) {
  return { type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null } as Parameters<typeof agy.runAgyTurn>[1];
}

async function started(card: Partial<Card> = {}, over: Record<string, unknown> = {}) {
  s.cards.set("card-1", { id: "card-1", ...card } as Card);
  const session = makeSession(over);
  const state = await agy.startAgy(session, EXE);
  return { session, state, child: rig.child() };
}

const kinds = () => s.handled.map((m) => {
  const content = (m.message as { content: { type: string; text?: string; name?: string }[] } | undefined)?.content[0];
  return m.type === "result" ? `result:${m.result as string}` : content?.type === "text" ? `text:${content.text}` : `tool:${content?.name}`;
});

describe("runAgyTurn", () => {
  it("streams agy's rows into the thread and ends on a result with its tokens", async () => {
    const { session, state, child } = await started();
    child.replies["session/prompt"] = { before: [chunk("Let me check. "), chunk("Running it."), L.runStart, L.runEnd, L.writeStart, L.writeEnd, L.readDenied, L.mcpStart, L.usage, L.chunk], result: { stopReason: "end_turn", usage: USAGE } };
    await agy.runAgyTurn(session, message("say hello"), state);
    expect(child.requests("session/prompt")[0]?.params).toEqual({ sessionId: "S", prompt: [{ type: "text", text: "say hello" }] });
    expect(kinds()).toEqual(["text:Let me check. Running it.", "tool:Bash", "tool:Write", "tool:Read", "tool:mcp__browser__open_url", "text:Executed the echo command.", "result:Executed the echo command."]);
    const thread = s.threads.get("card-1")!;
    expect(thread[0]).toMatchObject({ id: "call_1", result: "Command output:\nhello_weft", isError: false });
    expect(thread[1]).toMatchObject({ id: "call_2", result: "Wrote /tmp/p/x.txt." });
    // A tool whose start never came still gets its row, with the guards' refusal on it.
    expect(thread[2]).toMatchObject({ id: "call_3", result: "tool call denied by pre-tool hook: Weft guard: blocked", isError: true });
    expect(s.cards.get("card-1")?.touchedFiles).toEqual(["/tmp/p/x.txt"]);
    expect(s.published).toContainEqual({ type: "delta", cardId: "card-1", text: "Running it." });
    expect(s.handled.at(-1)).toMatchObject({ subtype: "success", modelUsage: { Antigravity: { inputTokens: 17008, outputTokens: 922, cacheReadInputTokens: 12355, cacheCreationInputTokens: 0 } } });
    expect(state.turn).toBeUndefined();
    agy.closeAgy(session, state);
  });

  it("sends an image pasted with the prompt as an ACP image block after the text", async () => {
    const { session, state, child } = await started();
    const withImage = message("what's this?");
    (withImage.message.content as unknown[]).push({ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } });
    await agy.runAgyTurn(session, withImage, state);
    expect(child.requests("session/prompt")[0]?.params?.prompt).toEqual([{ type: "text", text: "what's this?" }, { type: "image", mimeType: "image/png", data: "iVBOR" }]);
    agy.closeAgy(session, state);
  });

  it("says Done. for a turn with no reply, and the error for one agy stopped short", async () => {
    const { session, state, child } = await started();
    await agy.runAgyTurn(session, message("go"), state);
    expect(s.handled.at(-1)).toMatchObject({ result: "Done.", is_error: false });
    child.replies["session/prompt"] = { before: [chunk("  ")], result: { stopReason: "refusal" } };
    await agy.runAgyTurn(session, message("go"), state);
    expect(s.handled.at(-1)).toMatchObject({ result: "The model refused to continue this turn.", is_error: true });
    expect(kinds()).toHaveLength(2);
    agy.closeAgy(session, state);
  });

  it("sends the card's mode and pinned model before a turn, and only when they changed", async () => {
    const { session, state, child } = await started({ permissionMode: "default", model: "gemini-3-pro" });
    await agy.runAgyTurn(session, message("1"), state);
    await agy.runAgyTurn(session, message("2"), state);
    expect(child.requests("session/set_mode").map((m) => m.params)).toEqual([{ sessionId: "S", modeId: "default" }]);
    expect(child.requests("session/set_model").map((m) => m.params)).toEqual([{ sessionId: "S", modelId: "gemini-3-pro" }]);
    Object.assign(s.cards.get("card-1")!, { permissionMode: "acceptEdits", model: "antigravity-default" });
    await agy.runAgyTurn(session, message("3"), state);
    expect(child.requests("session/set_mode").at(-1)?.params).toEqual({ sessionId: "S", modeId: "accept-edits" });
    // agy's own default isn't sent: there's no slug to send.
    expect(child.requests("session/set_model")).toHaveLength(1);
    expect(s.handled.at(-1)?.modelUsage).toHaveProperty("Antigravity");
    agy.closeAgy(session, state);
  });

  it("reads the session's own spec when the card is gone", async () => {
    const { session, state, child } = await started({}, { cardId: undefined, spec: { cwd: CWD, backend: "antigravity", permissionMode: "auto", model: "m1" } });
    child.replies["session/prompt"] = { before: [chunk("no card to stream to")], result: { stopReason: "end_turn" } };
    await agy.runAgyTurn(session, message("go"), state);
    expect(s.published).toEqual([]);
    expect(child.requests("session/set_mode")[0]?.params).toMatchObject({ modeId: "auto" });
    expect(child.requests("session/set_model")[0]?.params).toMatchObject({ modelId: "m1" });
    expect(agy.agyLabel(session)).toBe("m1");
    agy.closeAgy(session, state);
  });

  it("fails with agy's stderr when its process dies mid-turn, or says the process ended", async () => {
    for (const why of ["agy: quota exhausted for gemini-3-pro\n", ""]) {
      const { session, state, child } = await started();
      child.replies["session/prompt"] = "silent";
      const turn = agy.runAgyTurn(session, message("go"), state);
      await vi.waitFor(() => expect(child.requests("session/prompt")).toHaveLength(1));
      child.die(why);
      await expect(turn).rejects.toThrow(why.trim() || "Antigravity's process ended.");
      expect(state.turn).toBeUndefined();
    }
  });
});

describe("answerPermission over ACP", () => {
  const answerTo = (child: FakeAgy, id: string) => new Promise<Rpc>((resolve) => child.on("received", (m: Rpc) => m.id === id && !m.method && resolve(m)));

  it("asks on the card about a call agy's mode doesn't allow, and picks agy's option for the answer", async () => {
    const { session, state, child } = await started();
    vi.mocked(askAboutCall).mockResolvedValueOnce({ behavior: "allow", updatedInput: {} }).mockResolvedValueOnce({ behavior: "deny", message: "no" });
    for (const optionId of ["allow", "deny"]) {
      const answered = answerTo(child, "1");
      child.send(L.permission);
      expect((await answered).result).toEqual({ outcome: { outcome: "selected", optionId } });
    }
    const [s0, tool, input, id, signal, title] = vi.mocked(askAboutCall).mock.calls[0]!;
    expect([s0, tool, input, id, title]).toEqual([session, "Bash", { command: "echo hello_weft" }, "call_1", "echo hello_weft"]);
    expect(signal).toBeInstanceOf(AbortSignal);
    agy.closeAgy(session, state);
  });

  it("lets Weft's own tools and a Bypass card through without asking", async () => {
    const { session, state, child } = await started();
    const mcp = L.permission.replace('"name":"run_command"', '"name":"mcp_browser_open_url"');
    const a = answerTo(child, "1");
    child.send(mcp);
    expect((await a).result).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
    s.cards.get("card-1")!.permissionMode = "bypassPermissions";
    const b = answerTo(child, "1");
    child.send(L.permission);
    expect((await b).result).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
    expect(askAboutCall).not.toHaveBeenCalled();
    agy.closeAgy(session, state);
  });
});

describe("answerPermission", () => {
  const state = () => ({}) as Parameters<typeof agy.answerPermission>[1];

  it("cancels when agy offers no option for the answer, and reads a request with nothing in it", async () => {
    const session = makeSession({ spec: { cwd: CWD, permissionMode: "bypassPermissions" } });
    expect(await agy.answerPermission(session, state(), { toolCall: { name: "run_command", args: { CommandLine: "ls" } }, options: [{ optionId: "x", kind: "reject_once" }, { optionId: "y" }] })).toEqual({ outcome: { outcome: "cancelled" } });
    expect(await agy.answerPermission(session, state(), null)).toEqual({ outcome: { outcome: "cancelled" } });
    expect(await agy.answerPermission(session, state(), { options: [{ optionId: "always", kind: "allow_always" }] })).toEqual({ outcome: { outcome: "selected", optionId: "always" } });
  });

  it("asks with no call id or title when agy gave none, and rejects always when that's all agy offers", async () => {
    vi.mocked(askAboutCall).mockResolvedValueOnce({ behavior: "deny", message: "" });
    const session = makeSession({ cardId: undefined });
    const out = await agy.answerPermission(session, state(), { toolCall: { name: "read_file", args: { Path: "x" } }, options: [{ optionId: "never", kind: "reject_always" }] });
    expect(out).toEqual({ outcome: { outcome: "selected", optionId: "never" } });
    expect(vi.mocked(askAboutCall).mock.calls[0]?.slice(1, 4)).toEqual(["Read", { file_path: "/tmp/p/x" }, ""]);
    expect(vi.mocked(askAboutCall).mock.calls[0]?.[5]).toBeUndefined();
  });

  it("drops the ask when the turn is cancelled", async () => {
    let seen: AbortSignal | undefined;
    vi.mocked(askAboutCall).mockImplementationOnce((_s, _t, _i, _id, signal) => {
      seen = signal;
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ behavior: "deny", message: "cancelled" })));
    });
    const turn = new AbortController();
    const pending = agy.answerPermission(makeSession(), { turn } as Parameters<typeof agy.answerPermission>[1], { toolCall: { name: "run_command" } });
    turn.abort();
    expect(await pending).toEqual({ outcome: { outcome: "cancelled" } });
    expect(seen?.aborted).toBe(true);
  });
});

describe("agyPromptBlocks", () => {
  it("is the prompt's text block, then one image block per pasted image, in order", () => {
    const msg = message("compare");
    (msg.message.content as unknown[]).push(
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
      { type: "image", source: { type: "url", url: "https://x" } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BBB" } },
    );
    expect(agy.agyPromptBlocks(makeSession(), msg)).toEqual([
      { type: "text", text: "compare" },
      { type: "image", mimeType: "image/png", data: "AAA" },
      { type: "image", mimeType: "image/jpeg", data: "BBB" },
    ]);
  });

  it("is a lone text block for a message with no images", () => {
    expect(agy.agyPromptBlocks(makeSession(), message("hi"))).toEqual([{ type: "text", text: "hi" }]);
  });

  it("is listed in the runner's build fingerprint", () => {
    expect(agy.ANTIGRAVITY_CODE).toContain(agy.agyPromptBlocks);
  });
});

describe("agyLabel", () => {
  it("is the card's pinned model, or Antigravity for agy's own", () => {
    s.cards.set("card-1", { id: "card-1", model: "gemini-3-flash" } as Card);
    expect(agy.agyLabel(makeSession())).toBe("gemini-3-flash");
    s.cards.set("card-1", { id: "card-1" } as Card);
    expect(agy.agyLabel(makeSession())).toBe("Antigravity");
  });
});
