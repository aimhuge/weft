// @vitest-environment node
// Live tool results with a screenshot wait for its WebP save (lib/runner-turn.ts), against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistant, flush, makeCard, nth, resetHarness, toolUse } from "./runner.harness";
import type { ThreadItem } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("./automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./automations")>()),
  skillsForPrompt: () => h.skillsForPrompt,
}));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

let runner: typeof import("./runner");
let cwd: string;
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
  vi.restoreAllMocks();
});

describe("a screenshot in a tool result", () => {
  it("is stored once it's saved as WebP", async () => {
    // The WebP save itself is tested in lib/thread-media.test.ts; here it only has to be waited for.
    const media = await import("./thread-media");
    vi.spyOn(media, "liveToolResult").mockReturnValue(Promise.resolve({ result: "", images: ["/api/attachments/shot.webp"] }));
    makeCard(h, cwd, { id: "c1" });
    runner.sendMessage("c1", "hello");
    await flush();
    const q = nth(h.queries, -1, "query");
    q.emit(assistant(toolUse("t1", "mcp__browser__screenshot", {})));
    q.emit({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }] },
    });
    await vi.waitFor(() => expect(thread("c1").find((i) => i.kind === "tool")).toMatchObject({ images: ["/api/attachments/shot.webp"] }));
  });
});

describe("a database call in flight", () => {
  it("is tracked from its tool_use until its tool_result (lib/db-calls.ts)", async () => {
    const { sessions } = await import("./runner-state");
    makeCard(h, cwd, { id: "c2" });
    runner.sendMessage("c2", "hello");
    await flush();
    const q = nth(h.queries, -1, "query");
    q.emit(assistant(toolUse("t2", "mcp__supabase__execute_sql", { query: "drop table t" })));
    await vi.waitFor(() => expect(sessions.get("c2")?.dbCalls?.get("t2")).toMatchObject({ server: "supabase", sql: "drop table t" }));
    q.emit({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "ok" }] } });
    await vi.waitFor(() => expect(sessions.get("c2")?.dbCalls?.has("t2")).toBe(false));
  });
});
