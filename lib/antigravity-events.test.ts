import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_EVENTS_CODE, agySteps, agyStopError, agyUsage } from "./antigravity-events";

// What agy's ACP session/update notifications mean for the thread (lib/antigravity-events.ts), read from the lines
// agy 1.5.16 really writes.

const CWD = "/tmp/p";
const params = (line: string) => (JSON.parse(line) as { params: unknown }).params;

const RUN_START = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call","toolCallId":"call_1","name":"run_command","args":{"CommandLine":"echo hello_weft","WaitMsBeforeAsync":5000,"toolSummary":"Echo hello weft"},"status":"in_progress","kind":"execute","title":"echo hello_weft","rawInput":{"CommandLine":"echo hello_weft","WaitMsBeforeAsync":5000,"toolSummary":"Echo hello weft"}}}}';
const RUN_END = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_1","name":"run_command","status":"completed","kind":"execute","rawInput":{"CommandLine":"echo hello_weft"},"rawOutput":{"output":"Command output:\\nhello_weft\\r\\n","exit_code":0},"content":[{"type":"content","content":{"type":"text","text":"Command output:\\nhello_weft\\r\\n"}}]}}}';
const WRITE_START = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call","toolCallId":"call_2","name":"write_file","args":{"Content":"a","Overwrite":true,"Path":"/tmp/p/x.txt"},"status":"in_progress","kind":"edit","title":"File x.txt","locations":[{"path":"/tmp/p/x.txt"}],"rawInput":{"Content":"a","Overwrite":true,"Path":"/tmp/p/x.txt"}}}}';
const WRITE_END = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_2","name":"write_file","status":"completed","kind":"edit","locations":[{"path":"/tmp/p/x.txt"}],"rawInput":{"Content":"a","Overwrite":true,"Path":"/tmp/p/x.txt"},"rawOutput":{},"content":[{"type":"diff","path":"/tmp/p/x.txt","newText":"a"}]}}}';
const READ_DENIED = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_3","name":"read_file","status":"failed","kind":"read","rawInput":{"Path":"/tmp/p/x.txt"},"rawOutput":"tool call denied by pre-tool hook: Weft guard: blocked","content":[{"type":"content","content":{"type":"text","text":"tool call denied by pre-tool hook: Weft guard: blocked"}}]}}}';
const MCP_START = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"tool_call","toolCallId":"call_4","name":"mcp_browser_open_url","args":{"url":"x","toolSummary":"open"},"status":"in_progress","kind":"other","rawInput":{"url":"x","toolSummary":"open"}}}}';
const CHUNK = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Executed the echo command."}}}}';
const USAGE = '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"usage_update","used":15082,"size":1048576}}}';
const RESULT = '{"jsonrpc":"2.0","result":{"stopReason":"end_turn","usage":{"inputTokens":17008,"outputTokens":511,"cachedReadTokens":12355,"cachedWriteTokens":0,"thoughtTokens":411,"totalTokens":29874}},"id":3}';

const update = (u: Record<string, unknown>) => ({ sessionId: "S", update: u });

describe("agySteps on agy 1.5.16's own lines", () => {
  it("reads a reply chunk as text", () => {
    expect(agySteps(params(CHUNK), CWD)).toEqual([{ kind: "text", text: "Executed the echo command." }]);
  });

  it("reads a command starting and finishing, with its output", () => {
    expect(agySteps(params(RUN_START), CWD)).toEqual([{ kind: "tool-start", id: "call_1", use: { name: "Bash", input: { command: "echo hello_weft", description: "Echo hello weft" } } }]);
    expect(agySteps(params(RUN_END), CWD)).toEqual([
      { kind: "tool-end", id: "call_1", use: { name: "Bash", input: { command: "echo hello_weft" } }, outcome: { result: "Command output:\nhello_weft", isError: false }, files: [] },
    ]);
  });

  it("reads a write as an edit that touched its file, with a word on the diff for its result", () => {
    expect(agySteps(params(WRITE_START), CWD)[0]).toMatchObject({ kind: "tool-start", id: "call_2", use: { name: "Write", input: { file_path: "/tmp/p/x.txt", content: "a" } } });
    expect(agySteps(params(WRITE_END), CWD)).toEqual([
      { kind: "tool-end", id: "call_2", use: { name: "Write", input: { file_path: "/tmp/p/x.txt", content: "a" } }, outcome: { result: "Wrote /tmp/p/x.txt.", isError: false }, files: ["/tmp/p/x.txt"] },
    ]);
  });

  it("reads a call the guards refused as a failed tool", () => {
    expect(agySteps(params(READ_DENIED), CWD)).toEqual([
      { kind: "tool-end", id: "call_3", use: { name: "Read", input: { file_path: "/tmp/p/x.txt" } }, outcome: { result: "tool call denied by pre-tool hook: Weft guard: blocked", isError: true }, files: [] },
    ]);
  });

  it("reads an MCP call in Claude Code's name", () => {
    expect(agySteps(params(MCP_START), CWD)).toEqual([{ kind: "tool-start", id: "call_4", use: { name: "mcp__browser__open_url", input: { url: "x" } } }]);
  });

  it("reads how full the context window is", () => {
    expect(agySteps(params(USAGE), CWD)).toEqual([{ kind: "context", used: 15082, size: 1048576 }]);
  });
});

describe("agySteps on edge cases", () => {
  it("is nothing for params that aren't an object, an update it doesn't show, or an empty chunk", () => {
    expect(agySteps(undefined, CWD)).toEqual([]);
    expect(agySteps([], CWD)).toEqual([]);
    expect(agySteps({ update: [] }, CWD)).toEqual([]);
    expect(agySteps(update({ sessionUpdate: "agent_thought_chunk", content: { text: "hmm" } }), CWD)).toEqual([]);
    expect(agySteps(update({ sessionUpdate: "agent_message_chunk", content: { text: "" } }), CWD)).toEqual([]);
    expect(agySteps(update({ sessionUpdate: "agent_message_chunk" }), CWD)).toEqual([]);
  });

  it("is nothing for a tool with no id, or an update that hasn't finished", () => {
    expect(agySteps(update({ sessionUpdate: "tool_call", name: "run_command" }), CWD)).toEqual([]);
    expect(agySteps(update({ sessionUpdate: "tool_call_update", status: "completed" }), CWD)).toEqual([]);
    expect(agySteps(update({ sessionUpdate: "tool_call_update", toolCallId: "c", status: "in_progress" }), CWD)).toEqual([]);
  });

  it("reads a tool's input from args when there's no rawInput, and a tool with no name or input as agy's own", () => {
    expect(agySteps(update({ sessionUpdate: "tool_call", toolCallId: "c", name: "run_command", args: { CommandLine: "ls" } }), CWD)[0]).toMatchObject({ use: { name: "Bash", input: { command: "ls" } } });
    expect(agySteps(update({ sessionUpdate: "tool_call", toolCallId: "c" }), CWD)).toEqual([{ kind: "tool-start", id: "c", use: { name: "", input: {} } }]);
  });

  it("takes a tool's output from rawOutput's string or {output} when its content has no text", () => {
    const end = (u: Record<string, unknown>) => agySteps(update({ sessionUpdate: "tool_call_update", toolCallId: "c", status: "completed", name: "run_command", ...u }), CWD)[0] as { outcome: { result: string } };
    expect(end({ rawOutput: "  plain  " }).outcome.result).toBe("plain");
    expect(end({ rawOutput: { output: " out \n" } }).outcome.result).toBe("out");
    expect(end({ content: [{ type: "content", content: { type: "text", text: "" } }], rawOutput: { output: "raw" } }).outcome.result).toBe("raw");
    expect(end({ content: [{ type: "content", content: { type: "image" } }, { type: "content", content: { type: "text", text: "a" } }, { type: "content", content: { type: "text", text: "b" } }] }).outcome.result).toBe("a\nb");
    expect(end({ content: "not a list" }).outcome.result).toBe("");
    expect(end({ rawOutput: { output: 5 } }).outcome.result).toBe("");
  });

  it("names every diff's file, skipping one with no path", () => {
    const step = agySteps(update({ sessionUpdate: "tool_call_update", toolCallId: "c", status: "completed", kind: "edit", name: "x", content: [{ type: "diff", path: "/a" }, { type: "diff" }, { type: "diff", path: "/b" }] }), CWD)[0];
    expect(step).toMatchObject({ outcome: { result: "Wrote /a, /b." } });
  });

  it("counts an edit's files once each, from its input and its locations, and none for a failed edit", () => {
    const base = { sessionUpdate: "tool_call_update", toolCallId: "c", kind: "edit", name: "replace_file_content", rawInput: { TargetFile: "/tmp/p/a.ts" } };
    expect(agySteps(update({ ...base, status: "completed", locations: [{ path: "/tmp/p/a.ts" }, { path: "/tmp/p/b.ts" }, {}, "junk"] }), CWD)[0]).toMatchObject({ files: ["/tmp/p/a.ts", "/tmp/p/b.ts"] });
    expect(agySteps(update({ ...base, status: "completed", locations: "none" }), CWD)[0]).toMatchObject({ files: ["/tmp/p/a.ts"] });
    expect(agySteps(update({ ...base, status: "failed", locations: [{ path: "/tmp/p/a.ts" }] }), CWD)[0]).toMatchObject({ files: [], outcome: { isError: true } });
  });

  it("drops a usage update that isn't numbers or has no window size", () => {
    expect(agySteps(update({ sessionUpdate: "usage_update", used: "x", size: 10 }), CWD)).toEqual([]);
    expect(agySteps(update({ sessionUpdate: "usage_update", used: 1, size: "y" }), CWD)).toEqual([]);
    expect(agySteps(update({ sessionUpdate: "usage_update", used: 1, size: 0 }), CWD)).toEqual([]);
  });
});

describe("agyUsage", () => {
  it("reads session/prompt's token counts, thinking counted as output", () => {
    expect(agyUsage((JSON.parse(RESULT) as { result: unknown }).result)).toEqual({ input: 17008, output: 922, cacheRead: 12355, cacheWrite: 0 });
  });

  it("is zeros for no usage or counts that aren't finite numbers", () => {
    expect(agyUsage(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(agyUsage({ usage: { inputTokens: "5", outputTokens: Number.NaN, cachedReadTokens: Infinity } })).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });
});

describe("agyStopError", () => {
  it("is undefined for a plain finish or a cancel, and says why for the rest", () => {
    expect(agyStopError({ stopReason: "end_turn" })).toBeUndefined();
    expect(agyStopError({ stopReason: "cancelled" })).toBeUndefined();
    expect(agyStopError(null)).toBeUndefined();
    expect(agyStopError({ stopReason: "refusal" })).toMatch(/refused/);
    expect(agyStopError({ stopReason: "max_tokens" })).toMatch(/output tokens/);
    expect(agyStopError({ stopReason: "max_turn_requests" })).toMatch(/limit on model requests/);
  });
});

it("lists its code for the runner's build fingerprint", () => {
  expect(ANTIGRAVITY_EVENTS_CODE).toEqual([agySteps, agyUsage, agyStopError]);
});
