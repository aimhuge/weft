import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./runner-state";

// The thread rows a CLI outside the Agent SDK files (lib/cli-messages.ts), as the SDK messages lib/runner-turn.ts
// knows. handle(), the store, the vault's redaction and the overlap bookkeeping are faked: each has its own tests.

const s = vi.hoisted(() => ({
  handled: [] as { cardId: string; msg: Record<string, unknown> }[],
  cards: new Map<string, Record<string, unknown>>(),
  threads: new Map<string, unknown[]>(),
  replaced: [] as { id: string; index: number; item: unknown }[],
  updates: [] as { id: string; patch: unknown }[],
}));

vi.mock("./runner-turn", () => ({
  handle: (cardId: string, session: Session, msg: Record<string, unknown>) => {
    s.handled.push({ cardId, msg });
    for (const block of ((msg.message as { content?: { type: string; id?: string }[] } | undefined)?.content ?? [])) {
      if (block.type !== "tool_use" || !block.id) continue;
      const items = s.threads.get(cardId) ?? [];
      s.threads.set(cardId, items);
      items.push({ kind: "tool", id: block.id });
      session.toolIndex.set(block.id, items.length - 1);
    }
    return Promise.resolve();
  },
}));
vi.mock("./store", () => ({
  getCard: (id: string) => s.cards.get(id),
  getThread: (id: string) => s.threads.get(id) ?? [],
  replaceThreadItem: (id: string, index: number, item: unknown) => {
    s.replaced.push({ id, index, item });
    (s.threads.get(id) as unknown[])[index] = item;
  },
  updateCard: (id: string, patch: Record<string, unknown>) => {
    s.updates.push({ id, patch });
    s.cards.set(id, { ...(s.cards.get(id) ?? {}), ...patch });
  },
}));
vi.mock("./secret-run", () => ({ redactStored: (_card: string, text: string) => Promise.resolve(text.replaceAll("hunter2", "‹PASSWORD›")) }));
vi.mock("./overlap", () => ({
  touchFile: (list: string[] | undefined, file: string) => (list?.includes(file) ? undefined : [...(list ?? []), file]),
}));

const m = await import("./cli-messages");

function session(over: Partial<Record<string, unknown>> = {}) {
  return { cardId: "card-1", spec: { cwd: "/w/proj" }, toolIndex: new Map<string, number>(), ...over } as unknown as Session;
}
const message = (i = 0) => s.handled[i]?.msg as { type: string; message: { id: string; model: string; content: Record<string, unknown>[] }; [k: string]: unknown };

beforeEach(() => {
  s.handled.length = 0;
  s.replaced.length = 0;
  s.updates.length = 0;
  s.cards.clear();
  s.threads.clear();
  vi.restoreAllMocks();
});

describe("scrub", () => {
  it("swaps the card's vault values out, and leaves a card-less thread's text alone", async () => {
    expect(await m.scrub(session(), "pw hunter2")).toBe("pw ‹PASSWORD›");
    expect(await m.scrub(session({ cardId: undefined }), "pw hunter2")).toBe("pw hunter2");
  });
});

describe("fileReply", () => {
  it("files the reply as an assistant text row under the model, scrubbed", async () => {
    await m.fileReply(session(), "said hunter2", "gemini-3", "agy");
    expect(s.handled[0]?.cardId).toBe("card-1");
    const msg = message();
    expect(msg).toMatchObject({ type: "assistant", parent_tool_use_id: null });
    expect(msg.message).toMatchObject({ role: "assistant", model: "gemini-3", content: [{ type: "text", text: "said ‹PASSWORD›" }] });
    expect(msg.message.id).toMatch(/^agy-\d+$/);
  });
});

describe("fileToolStart", () => {
  it("files a tool row with the call's id, name and input", async () => {
    const sess = session();
    await m.fileToolStart(sess, "call_1", { name: "Bash", input: { command: "echo hello_weft" } }, "M", "agy");
    expect(message().message).toMatchObject({ id: "agy-call_1", model: "M", content: [{ type: "tool_use", id: "call_1", name: "Bash", input: { command: "echo hello_weft" } }] });
    expect(sess.toolIndex.get("call_1")).toBe(0);
  });

  it("draws nothing for a call with no id, or a second start of one already drawn", async () => {
    const sess = session();
    await m.fileToolStart(sess, "", { name: "Bash", input: {} }, "M", "agy");
    await m.fileToolStart(sess, "call_1", { name: "Bash", input: {} }, "M", "agy");
    await m.fileToolStart(sess, "call_1", { name: "Bash", input: {} }, "M", "agy");
    expect(s.handled).toHaveLength(1);
  });
});

describe("fileToolResult", () => {
  it("writes the scrubbed result onto the tool's row", async () => {
    const sess = session();
    await m.fileToolStart(sess, "call_1", { name: "Bash", input: {} }, "M", "agy");
    await m.fileToolResult(sess, "call_1", { result: "out hunter2", isError: true });
    expect(s.replaced).toEqual([{ id: "card-1", index: 0, item: { kind: "tool", id: "call_1", result: "out ‹PASSWORD›", isError: true } }]);
  });

  it("drops a result with no row, no card, or a row that isn't a tool", async () => {
    const sess = session();
    await m.fileToolResult(sess, "never-started", { result: "x", isError: false });
    sess.toolIndex.set("gone", 4);
    await m.fileToolResult(sess, "gone", { result: "x", isError: false });
    s.threads.set("card-1", [{ kind: "text" }]);
    sess.toolIndex.set("text", 0);
    await m.fileToolResult(sess, "text", { result: "x", isError: false });
    const cardless = session({ cardId: undefined });
    cardless.toolIndex.set("t", 0);
    await m.fileToolResult(cardless, "t", { result: "x", isError: false });
    expect(s.replaced).toEqual([]);
  });
});

describe("fileResult", () => {
  it("files a success with the reply it ended on and every token count", async () => {
    await m.fileResult(session({ sessionId: "S" }), "M", { text: "All done hunter2", usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } });
    expect(message()).toMatchObject({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "All done ‹PASSWORD›",
      session_id: "S",
      total_cost_usd: 0,
      modelUsage: { M: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 } },
    });
  });

  it("says Done. with no reply, zero tokens with no usage, and the spec's session id when the session has none", async () => {
    await m.fileResult(session({ spec: { cwd: "/w", sessionId: "from-spec" } }), "M", { text: "" });
    expect(message()).toMatchObject({ result: "Done.", session_id: "from-spec", modelUsage: { M: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } });
    await m.fileResult(session(), "M", { usage: {} });
    expect(message(1)).toMatchObject({ result: "Done.", session_id: "" });
  });

  it("files an error as the result, flagged", async () => {
    await m.fileResult(session(), "M", { text: "partial", error: "The model refused." });
    expect(message()).toMatchObject({ subtype: "error_execution", is_error: true, result: "The model refused." });
  });

  it("files nothing for a thread with no card", async () => {
    await m.fileResult(session({ cardId: undefined }), "M", { text: "x" });
    expect(s.handled).toEqual([]);
  });
});

describe("insideFolder", () => {
  it("counts the folder itself and paths under it, not a sibling that shares its prefix", () => {
    expect(m.insideFolder("/w/p", "/w/p")).toBe(true);
    expect(m.insideFolder("/w/p/a.ts", "/w/p")).toBe(true);
    expect(m.insideFolder("/w/proj/a.ts", "/w/p")).toBe(false);
    expect(m.insideFolder("/anything", "/")).toBe(true);
  });
});

describe("noteTouched", () => {
  it("keeps the card's files, resolved against its folder, and only those inside it", () => {
    s.cards.set("card-1", { id: "card-1" });
    m.noteTouched(session(), ["a.ts", "/w/proj/b.ts", "", "../escape.ts", "/elsewhere/c.ts", "a.ts"]);
    expect(s.updates).toEqual([
      { id: "card-1", patch: { touchedFiles: [path.resolve("/w/proj/a.ts")] } },
      { id: "card-1", patch: { touchedFiles: [path.resolve("/w/proj/a.ts"), "/w/proj/b.ts"] } },
    ]);
  });

  it("starts the list for a card it can't find, and does nothing with no card", () => {
    m.noteTouched(session(), ["x.ts"]);
    expect(s.updates).toEqual([{ id: "card-1", patch: { touchedFiles: ["/w/proj/x.ts"] } }]);
    m.noteTouched(session({ cardId: undefined }), ["y.ts"]);
    expect(s.updates).toHaveLength(1);
  });
});

describe("keepSessionId", () => {
  it("keeps a new id on the session and its card, once", () => {
    const sess = session();
    m.keepSessionId(sess, "S1");
    m.keepSessionId(sess, "S1");
    m.keepSessionId(sess, "");
    expect(sess.sessionId).toBe("S1");
    expect(s.updates).toEqual([{ id: "card-1", patch: { sessionId: "S1" } }]);
  });

  it("keeps it on the session alone when there's no card", () => {
    const sess = session({ cardId: undefined });
    m.keepSessionId(sess, "S2");
    expect(sess.sessionId).toBe("S2");
    expect(s.updates).toEqual([]);
  });
});

describe("stderrLogger", () => {
  it("logs stderr tagged with the card, or as a spare's", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.stderrLogger(session({ cardId: "abcdefghijk" }))("warn: x\n");
    m.stderrLogger(session({ cardId: undefined }))("y  ");
    expect(error.mock.calls).toEqual([["[thread abcdefgh] warn: x"], ["[thread spare] y"]]);
  });
});

it("lists its code for the runner's build fingerprint", () => {
  expect(m.CLI_MESSAGES_CODE).toHaveLength(9);
});
