// @vitest-environment node
// Drive lib/codex-runner.ts's turn loop against a fake `codex exec` child: what argv/env it is started
// with, and what its JSON event stream becomes in the card's thread. The failing-turn paths are in
// lib/codex-runner-turn.test.ts; lib/codex-runner.test.ts covers the pure helpers.
import { describe, expect, it, vi } from "vitest";
import { EXE, setupCodex } from "./codex-runner.harness";
import { codexGuardArgs } from "./guards/codex";
import { GuardsUnavailable, openGuards } from "./guards/turn";
import type { Card } from "./types";

const s = await vi.hoisted(async () => (await import("./codex-runner.harness")).codexState());

vi.mock("./guards/turn", async (o) => (await import("./codex-runner.harness")).guardsTurnMock(o));
vi.mock("./runner-turn", async () => (await import("./codex-runner.harness")).runnerTurnMock(s));
vi.mock("./store", async () => (await import("./codex-runner.harness")).storeMock(s));
vi.mock("./weft-mcp", async () => (await import("./codex-runner.harness")).weftMcpMock());
vi.mock("node:child_process", async () => (await import("./codex-runner.harness")).childProcessMock(s));
vi.mock("./settings", async (o) => (await import("./codex-runner.harness")).settingsMock(o));

const rig = setupCodex(s);

/** An assistant message's content blocks, or none. */
const contentOf = (msg: unknown) => (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
/** The non-text blocks of every assistant message handle() saw. */
const blocks = () =>
  s.handled.flatMap((h) => (contentOf(h.msg) as { type: string }[])).filter((b) => b.type !== "text");
const results = () => s.handled.filter((h) => h.msg.type === "result").map((h) => h.msg);
const texts = () => s.handled.flatMap((h) => (contentOf(h.msg) as { text?: string }[])).flatMap((c) => (c.text ? [c.text] : []));
/** The thread item a tool call became, found by the index toolStart/toolFinish track it under. */
const threadItem = (id: string) => {
  const index = rig().session.toolIndex.get(id) as number;
  return (s.threads.get("card-1") ?? []).at(index) as Record<string, unknown> | undefined;
};
const event = (payload: Record<string, unknown>) => JSON.stringify(payload);

describe("driveCodex starts codex exec", () => {
  it("feeds the prompt on stdin and reads the turn's events off stdout", async () => {
    await rig().run([event({ type: "thread.started", thread_id: "th-1" }), event({ type: "turn.completed" })]);
    const prompt = ((rig().child().stdin.read() as Buffer | null) ?? Buffer.from("")).toString();
    expect(rig().opts()).toMatchObject({ command: EXE, cwd: rig().cwd });
    expect(rig().opts().args).toEqual([
      "exec", "--json", "--cd", rig().cwd, "--skip-git-repo-check", ...codexGuardArgs(),
      "--sandbox", "read-only", "--config", 'approval_policy="never"', "-",
    ]);
    expect(prompt).toContain("do it");
    expect(rig().session.sessionId).toBe("th-1");
  });

  it("runs every turn behind Weft's guards: its hooks in the argv, its token in the env, closed after", async () => {
    await rig().run([event({ type: "turn.completed" })]);
    expect(rig().opts().args).toContain("--dangerously-bypass-hook-trust");
    expect(rig().opts().env.WEFT_GUARD_TOKEN).toBe("guard-token");
    const opened = vi.mocked(openGuards).mock.results.at(-1)?.value as { close: () => void };
    expect(opened.close).toHaveBeenCalled();
  });

  it("refuses to start a turn whose guards can't be installed, and says why", async () => {
    vi.mocked(openGuards).mockImplementationOnce(() => {
      throw new GuardsUnavailable("Weft's server port isn't known");
    });
    const r = rig();
    const turn = r.codex.driveCodex(r.session, EXE);
    r.session.inbox.push("do it");
    await expect(turn).rejects.toThrow("guards couldn't be installed");
    expect(s.spawned).toHaveLength(0);
  });

  it("strips CLAUDE_CODE_ENTRYPOINT from the env the CLI gets", async () => {
    await rig().run([]);
    expect(rig().opts().env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(rig().opts().env.WEFT_SERVER_PID).toBe(String(process.pid));
  });

  it("resumes a saved session with `exec resume` instead of a new one", async () => {
    rig().session.sessionId = "th-old";
    await rig().run([]);
    expect(rig().opts().args.slice(0, 3)).toEqual(["exec", "resume", "--json"]);
    expect(rig().opts().args).toContain("th-old");
    expect(rig().opts().args).not.toContain("--cd");
  });

  it("names Weft's MCP servers for a turn once the server has a port", async () => {
    vi.stubEnv("PORT", "4321");
    await rig().run([]);
    expect(rig().opts().env.WEFT_MCP_TOKEN).toBeTruthy();
    expect(rig().opts().args).toContain(`mcp_servers.browser.url=${JSON.stringify("http://127.0.0.1:4321/api/mcp/browser")}`);
    expect(rig().opts().args).toContain('mcp_servers.board.bearer_token_env_var="WEFT_MCP_TOKEN"');
  });

  it("passes pasted images as --image files and cleans the temp folder up", async () => {
    const r = rig();
    const promise = r.codex.driveCodex(r.session, EXE);
    r.pushRaw({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } }] },
    });
    await vi.waitFor(() => expect(s.spawned.length).toBe(1));
    const image = r.opts().args[r.opts().args.indexOf("--image") + 1] as string;
    expect(image).toMatch(/image-0\.png$/);
    r.child().run(s, [event({ type: "turn.completed" })]);
    await r.finish(promise);
    expect(await import("node:fs").then((fs) => fs.existsSync(image.slice(0, image.lastIndexOf("/"))))).toBe(false);
  });

  it("stops before starting a turn once the session is aborted", async () => {
    const r = rig();
    r.session.abort.abort();
    r.session.inbox.push("do it");
    await r.codex.driveCodex(r.session, EXE);
    expect(s.spawned).toHaveLength(0);
  });
});

describe("Codex events become thread items", () => {
  it("records the session id from thread.started on the session and the card", async () => {
    await rig().run([event({ type: "thread.started", thread_id: "th-9" })]);
    expect(rig().session.sessionId).toBe("th-9");
    expect(s.cards.get("card-1")?.sessionId).toBe("th-9");
  });

  it("ignores a thread.started with no id", async () => {
    await rig().run([event({ type: "thread.started" })]);
    expect(rig().session.sessionId).toBeUndefined();
    expect(s.cards.get("card-1")?.sessionId).toBeUndefined();
  });

  it("shows a shell command as one Bash item, started then filled in", async () => {
    await rig().run([
      event({ type: "item.started", item: { id: "t1", type: "command_execution", command: "ls -la" } }),
      event({ type: "item.completed", item: { id: "t1", type: "command_execution", command: "ls -la", aggregated_output: "a.ts\n", exit_code: 0 } }),
    ]);
    expect(blocks()).toEqual([expect.objectContaining({ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } })]);
    expect(threadItem("t1")).toMatchObject({ result: "a.ts", isError: false });
  });

  it("records a failed command's exit code when Codex gave no output", async () => {
    await rig().run([
      event({ type: "item.started", item: { id: "t1", type: "command_execution", command: "false" } }),
      event({ type: "item.completed", item: { id: "t1", type: "command_execution", exit_code: 3, status: "failed" } }),
    ]);
    expect(threadItem("t1")).toMatchObject({ result: "Exited with code 3.", isError: true });
  });

  it("shows an MCP call under its mcp__server__tool name, filled from the result's text", async () => {
    await rig().run([
      event({ type: "item.started", item: { id: "t1", type: "mcp_tool_call", server: "browser", tool: "open_url", arguments: { url: "http://x" } } }),
      event({ type: "item.completed", item: { id: "t1", type: "mcp_tool_call", server: "browser", tool: "open_url", result: { content: [{ type: "text", text: "opened" }] } } }),
    ]);
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toMatchObject({ name: "mcp__browser__open_url", input: { url: "http://x" } });
    expect(threadItem("t1")).toMatchObject({ result: "opened", isError: false });
  });

  it("notes a file_change's paths on the card as absolute touched files", async () => {
    s.cards.set("card-1", { id: "card-1", touchedFiles: [] } as unknown as Card);
    await rig().run([event({ type: "item.completed", item: { type: "file_change", changes: [{ path: "a.ts" }, {}, { path: "a.ts" }] } })]);
    expect(s.cards.get("card-1")?.touchedFiles).toEqual([`${rig().cwd}/a.ts`]);
  });

  it("notes nothing on a file_change with no card", async () => {
    rig().session.cardId = null;
    await rig().run([event({ type: "item.completed", item: { type: "file_change", changes: [{ path: "a.ts" }] } })]);
    expect(s.handled).toHaveLength(0);
  });

  it("puts an agent_message's text in the thread under the model Codex ran", async () => {
    await rig().run([event({ type: "item.completed", item: { type: "agent_message", text: "All done." } })]);
    expect(texts()).toEqual(["All done."]);
    expect((s.handled[0]!.msg.message as { model: string }).model).toBe("Codex");
  });

  it("names the card's model on the reply when it isn't Codex's default", async () => {
    rig().session.spec.model = "gpt-5-codex";
    await rig().run([event({ type: "item.completed", item: { type: "agent_message", text: "hi" } })]);
    expect((s.handled[0]!.msg.message as { model: string }).model).toBe("gpt-5-codex");
  });

  it("ignores an event with no item, one that isn't complete, one that isn't a tool, and unknown types", async () => {
    await rig().run([
      event({ type: "item.completed" }),
      event({ type: "item.started", item: { id: "t1", type: "agent_message", text: "half" } }),
      event({ type: "item.updated", item: { id: "t1", type: "command_execution", command: "ls" } }),
      event({ type: "item.completed", item: { id: "t2", type: "reasoning", text: "thinking" } }),
      event({ type: "turn.started" }),
      event({ type: "something.new" }),
    ]);
    // Only the turn.completed run() appends reached the thread.
    expect(s.handled.map((h) => h.msg.type)).toEqual(["result"]);
  });

  it("skips a blank line and one that isn't JSON", async () => {
    await rig().run(["   ", "not json"]);
    expect(results()).toHaveLength(1);
  });
});

describe("the turn's result", () => {
  it("ends a completed turn with a success result and its usage under Codex", async () => {
    await rig().run([event({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 4, cached_input_tokens: 2, cache_write_input_tokens: 1 } })]);
    const [result] = results();
    expect(result).toMatchObject({ subtype: "success", is_error: false, result: "Done.", session_id: "" });
    expect((result!.modelUsage as Record<string, { inputTokens: number }>).Codex).toMatchObject({
      inputTokens: 10, outputTokens: 4, cacheReadInputTokens: 2, cacheCreationInputTokens: 1,
    });
  });

  it("puts a named model's usage under that model, and the session id in the result", async () => {
    rig().session.spec.model = "gpt-5-codex";
    rig().session.sessionId = "th-3";
    await rig().run([]);
    const result = results()[0]!;
    expect(Object.keys(result.modelUsage as object)).toEqual(["gpt-5-codex"]);
    expect(result.session_id).toBe("th-3");
  });

  it("falls back to the spec's session id when the session has none yet", async () => {
    rig().session.spec.sessionId = "th-spec";
    await rig().run([]);
    expect(results()[0]!.session_id).toBe("th-spec");
  });

  it("reports a failed turn's error message as an error result", async () => {
    await rig().run([event({ type: "turn.failed", error: { message: "model overloaded" } })]);
    expect(results()[0]).toMatchObject({ subtype: "error_execution", is_error: true, result: "model overloaded" });
  });

  it("names a failed turn with no error message", async () => {
    await rig().run([event({ type: "turn.failed" })]);
    expect(results()[0]!.result).toBe("Codex turn failed.");
  });

  it("writes no result at all for a session with no card", async () => {
    rig().session.cardId = null;
    await rig().run([event({ type: "turn.completed" })]);
    expect(results()).toHaveLength(0);
  });
});