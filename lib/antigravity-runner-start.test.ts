import { describe, expect, it, vi } from "vitest";
import { CWD, EXE, makeSession, type Rpc } from "./antigravity-runner.harness";

// Starting `agy acp` for a card (lib/antigravity-runner.ts startAgy, closeAgy, cancelAgy), against a fake agy that
// speaks ACP over stdio: initialize, a new conversation or the card's own resumed, and the cleanup when it fails.

const s = vi.hoisted(() => ({}) as import("./antigravity-runner.harness").State);
vi.mock("node:child_process", async () => (await import("./antigravity-runner.harness")).childProcessMock(s));
vi.mock("./runner-turn", async () => (await import("./antigravity-runner.harness")).runnerTurnMock(s));
vi.mock("./store", async () => (await import("./antigravity-runner.harness")).storeMock(s));
vi.mock("./guards/antigravity", async () => (await import("./antigravity-runner.harness")).guardsMock());
vi.mock("./antigravity-mcp", async () => (await import("./antigravity-runner.harness")).mcpMock());
vi.mock("./antigravity-models", async () => (await import("./antigravity-runner.harness")).modelsMock());
vi.mock("./guards/ask", () => ({ askAboutCall: vi.fn() }));
vi.mock("./connector-env", async (importOriginal) => {
  const real = await importOriginal<typeof import("./connector-env")>();
  // Off a worker the real one never asks which card; this records it, so the runner's answer is checked.
  return { ...real, withConnectorEnv: (env: Record<string, string | undefined>, cardId: () => string | undefined) => ({ ...env, CARD_ASKED: String(cardId()) }) };
});
vi.mock("./env", () => ({ cliEnv: () => ({ PATH: "/usr/bin", CLAUDE_CODE_ENTRYPOINT: "sdk-ts" }) }));
vi.mock("./secret-run", () => ({ redactStored: (_c: string, t: string) => Promise.resolve(t) }));
vi.mock("./overlap", () => ({ touchFile: (list: string[] | undefined, f: string) => [...(list ?? []), f] }));
vi.mock("./weft-prompts", async () => (await import("./antigravity-runner.harness")).promptDepsMocks.weftPrompts());
vi.mock("./puku-context", async () => (await import("./antigravity-runner.harness")).promptDepsMocks.pukuContext());
vi.mock("./skills", async () => (await import("./antigravity-runner.harness")).promptDepsMocks.skills());

const { agyState, setupAgy } = await import("./antigravity-runner.harness");
Object.assign(s, agyState());
const rig = setupAgy(s);
const agy = await import("./antigravity-runner");
const { openAgyGuards } = await import("./guards/antigravity");
const { openAgyMcp } = await import("./antigravity-mcp");
const { rememberAgyModels } = await import("./antigravity-models");

const guardsOf = () => vi.mocked(openAgyGuards).mock.results.at(-1)?.value as { bind: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
const mcpOf = () => vi.mocked(openAgyMcp).mock.results.at(-1)?.value as { close: ReturnType<typeof vi.fn> };
const CHUNK = (text: string) => JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "OLD", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });

describe("startAgy", () => {
  it("starts agy acp with Weft's guards in its env, opens a new conversation and keeps its id", async () => {
    s.replies = { "session/new": { result: { sessionId: "S", models: { availableModels: [{ modelId: "gemini-3-pro" }] } } } };
    const session = makeSession();
    const state = await agy.startAgy(session, EXE);
    const child = rig.child();
    expect(child.options).toMatchObject({ command: EXE, args: ["acp"], cwd: CWD });
    expect(child.options.env.WEFT_GUARD_URL).toBe("http://127.0.0.1:7/api/guards");
    expect(child.options.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(child.options.env.CARD_ASKED).toBe("card-1");
    // A broken pipe on agy's stdin is the process ending, which listen() reports; it never throws here.
    child.stdin.emit("error", new Error("EPIPE"));
    expect(session.process).toBe(state.proc);
    expect(child.requests("initialize")[0]?.params).toEqual({ protocolVersion: 1, clientCapabilities: {} });
    expect(child.requests("session/new")[0]?.params).toEqual({
      cwd: CWD,
      mcpServers: [{ name: "browser", command: "node", args: ["relay", "url"], env: [] }],
      _meta: { antigravity: { systemPrompt: { append: "WEFT PROMPT" } } },
    });
    expect(state.sessionId).toBe("S");
    expect(session.sessionId).toBe("S");
    expect(s.cards.get("card-1")?.sessionId).toBe("S");
    expect(guardsOf().bind).toHaveBeenCalledWith("S");
    expect(child.requests("session/load")).toEqual([]);
    // What the account can use, kept for the pickers.
    expect(vi.mocked(rememberAgyModels).mock.calls).toEqual([[{ availableModels: [{ modelId: "gemini-3-pro" }] }]]);
    agy.closeAgy(session, state);
  });

  it("resumes the card's conversation with session/load, without filing the history agy replays", async () => {
    s.replies = { "session/load": { before: [CHUNK("old reply")], result: { models: { currentModelId: "m" } } } };
    const session = makeSession({ spec: { cwd: CWD, backend: "antigravity", permissionMode: "default", sessionId: "OLD" } });
    const state = await agy.startAgy(session, EXE);
    const child = rig.child();
    expect(child.requests("session/load")[0]?.params).toEqual({ sessionId: "OLD", cwd: CWD, mcpServers: expect.any(Array) as unknown });
    expect(child.requests("session/new")).toEqual([]);
    expect(state.sessionId).toBe("OLD");
    expect(state.replaying).toBe(false);
    expect(s.handled).toEqual([]);
    expect(guardsOf().bind).toHaveBeenCalledWith("OLD");
    expect(vi.mocked(rememberAgyModels).mock.calls).toEqual([[{ currentModelId: "m" }]]);
    agy.closeAgy(session, state);
  });

  it("prefers the session's own id to the spec's, and starts a new conversation when agy no longer has it", async () => {
    s.replies = { "session/load": { error: { code: -32002, message: "Session not found" } } };
    const session = makeSession({ sessionId: "GONE", spec: { cwd: CWD, backend: "antigravity", permissionMode: "default", sessionId: "OLDER" } });
    const state = await agy.startAgy(session, EXE);
    const child = rig.child();
    expect(child.requests("session/load")[0]?.params?.sessionId).toBe("GONE");
    expect(child.requests("session/new")).toHaveLength(1);
    expect(state.sessionId).toBe("S");
    expect(session.sessionId).toBe("S");
    expect(state.replaying).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("couldn't resume GONE"), expect.anything());
    // Only the new conversation's models: the failed load had none to give.
    expect(vi.mocked(rememberAgyModels).mock.calls).toEqual([[undefined]]);
    agy.closeAgy(session, state);
  });

  it("remembers no models from a resumed conversation agy answered with nothing", async () => {
    s.replies = { "session/load": { result: null } };
    const session = makeSession({ sessionId: "OLD" });
    const state = await agy.startAgy(session, EXE);
    expect(state.sessionId).toBe("OLD");
    expect(vi.mocked(rememberAgyModels).mock.calls).toEqual([[undefined]]);
    agy.closeAgy(session, state);
  });

  it("fails, and closes what it opened, when agy opens no conversation", async () => {
    s.replies = { "session/new": { result: {} } };
    await expect(agy.startAgy(makeSession(), EXE)).rejects.toThrow("Antigravity didn't open a conversation.");
    expect(rememberAgyModels).not.toHaveBeenCalled();
    expect(rig.child().stdinEnded).toBe(true);
    expect(guardsOf().close).toHaveBeenCalledTimes(1);
    expect(mcpOf().close).toHaveBeenCalledTimes(1);
    expect(guardsOf().bind).not.toHaveBeenCalled();
    s.replies = { "session/new": { result: null } };
    await expect(agy.startAgy(makeSession(), EXE)).rejects.toThrow("Antigravity didn't open a conversation.");
  });

  it("fails with agy's error, and closes what it opened, when initialize is refused", async () => {
    s.replies = { initialize: { error: { message: "Please sign in to Antigravity." } } };
    await expect(agy.startAgy(makeSession(), EXE)).rejects.toThrow("Please sign in to Antigravity.");
    expect(rig.child().stdinEnded).toBe(true);
    expect(rig.child().requests("session/new")).toEqual([]);
    expect(guardsOf().close).toHaveBeenCalledTimes(1);
    expect(mcpOf().close).toHaveBeenCalledTimes(1);
  });

  it("fails with agy's stderr when it exits before it answers initialize", async () => {
    s.replies = { initialize: "silent" };
    const started = agy.startAgy(makeSession(), EXE);
    await vi.waitFor(() => expect(rig.child().received).toHaveLength(1));
    rig.child().die("agy: command not found: acp\n");
    await expect(started).rejects.toThrow("agy: command not found: acp");
    expect(guardsOf().close).toHaveBeenCalledTimes(1);
  });

  it("closes the guards and tools when agy can't be spawned at all", async () => {
    s.throwOn = "spawn agy ENOENT";
    await expect(agy.startAgy(makeSession(), EXE)).rejects.toThrow("spawn agy ENOENT");
    expect(s.spawned).toEqual([]);
    expect(guardsOf().close).toHaveBeenCalledTimes(1);
    expect(mcpOf().close).toHaveBeenCalledTimes(1);
  });

  it("asks for no card on a thread that has none", async () => {
    const session = makeSession({ cardId: undefined });
    const state = await agy.startAgy(session, EXE);
    expect(rig.child().options.env.CARD_ASKED).toBe("undefined");
    agy.closeAgy(session, state);
  });

  it("doesn't start agy at all without its guards", async () => {
    vi.mocked(openAgyGuards).mockImplementationOnce(() => {
      throw new Error("guards unavailable");
    });
    await expect(agy.startAgy(makeSession(), EXE)).rejects.toThrow("guards unavailable");
    expect(s.spawned).toEqual([]);
  });

  it("answers an agy request it doesn't handle with an error, and ignores notifications that aren't session updates", async () => {
    const session = makeSession();
    const state = await agy.startAgy(session, EXE);
    const child = rig.child();
    const answered = new Promise<Rpc>((resolve) => child.on("received", (m: Rpc) => m.id === "fs1" && resolve(m)));
    child.send(JSON.stringify({ jsonrpc: "2.0", method: "session/notice", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "x" } } } }));
    child.send(JSON.stringify({ jsonrpc: "2.0", id: "fs1", method: "fs/read_text_file", params: { path: "/a" } }));
    expect((await answered).error).toEqual({ code: -32603, message: "Weft doesn't answer fs/read_text_file." });
    expect(s.handled).toEqual([]);
    agy.closeAgy(session, state);
  });
});

describe("cancelAgy and closeAgy", () => {
  it("cancels the conversation's turn with session/cancel and keeps the process", async () => {
    const session = makeSession();
    const state = await agy.startAgy(session, EXE);
    const turn = new AbortController();
    state.turn = turn;
    agy.cancelAgy(session, state);
    await vi.waitFor(() => expect(rig.child().received.some((m) => m.method === "session/cancel")).toBe(true));
    expect(rig.child().received.find((m) => m.method === "session/cancel")).toEqual({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "S" } });
    expect(turn.signal.aborted).toBe(true);
    expect(rig.child().stdinEnded).toBe(false);
    state.turn = undefined;
    agy.cancelAgy(session, state);
    agy.closeAgy(session, state);
  });

  it("ends stdin, fails what's still waiting, and closes the guards and tools", async () => {
    const session = makeSession();
    const state = await agy.startAgy(session, EXE);
    s.spawned[0]!.replies["session/prompt"] = "silent";
    const waiting = state.client.request("session/prompt", {});
    agy.closeAgy(session, state);
    await expect(waiting).rejects.toThrow("The agent's process ended.");
    await vi.waitFor(() => expect(rig.child().stdinEnded).toBe(true));
    expect(guardsOf().close).toHaveBeenCalledTimes(1);
    expect(mcpOf().close).toHaveBeenCalledTimes(1);
  });
});

describe("antigravityAdapter", () => {
  it("is a warm adapter that starts agy with the executable it was given", async () => {
    const adapter = agy.antigravityAdapter(EXE);
    expect(adapter).toMatchObject({ name: "Antigravity", runTurn: agy.runAgyTurn, cancel: agy.cancelAgy, close: agy.closeAgy });
    const session = makeSession();
    const state = await adapter.start!(session);
    expect(rig.child().options.command).toBe(EXE);
    agy.closeAgy(session, state);
  });

  it("lists its code for the runner's build fingerprint", () => {
    expect(agy.ANTIGRAVITY_CODE).toContain(agy.startAgy);
    expect(agy.ANTIGRAVITY_CODE).toContain(agy.answerPermission);
  });
});
