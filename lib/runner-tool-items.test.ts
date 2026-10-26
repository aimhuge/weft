// @vitest-environment node
// lib/runner.ts against the fake SDK in lib/runner.harness.ts: what a tool call records on its thread item
// (the file it touched and an edit preview), and the limit hits a refused request logs.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistant, flush, makeCard, nth, resetHarness, toolUse } from "./runner.harness";
import type { Card, ThreadItem } from "./types";

const { recordLimit } = await import("./activity");
const recorded = vi.hoisted(() => [] as { model: string; at: number; resetsAt?: number }[]);
const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("./activity", async (importOriginal) => ({ ...(await importOriginal<typeof import("./activity")>()), recordLimit: vi.fn() }));
// The per-model store writes to ~/.weft, so it is mocked: a test that really wrote there would
// leave the machine's own model limits behind.
vi.mock("./model-limit", () => ({
  recordModelLimit: (model: string, at: number, resetsAt?: number) => recorded.push({ model, at, ...(resetsAt !== undefined && { resetsAt }) }),
  modelLimit: () => undefined,
  modelLimits: () => [],
  isModelLimited: () => false,
  limitedModels: () => [],
  clearModelLimit: () => {},
}));
vi.mock("./automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./automations")>()),
  skillsForPrompt: () => h.skillsForPrompt,
}));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

type Runner = typeof import("./runner");
let runner: Runner;
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];
const lastQuery = () => nth(h.queries, -1, "query");

async function send(id: string, msg = "hello") {
  runner.sendMessage(id, msg);
  await flush();
  return lastQuery();
}

beforeEach(async () => {
  cwd = resetHarness(h);
  recorded.length = 0;
  vi.mocked(recordLimit).mockClear();
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  vi.useRealTimers();
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("tool item preview", () => {
  it("records the file and an EditPreview on Edit/Write/MultiEdit/NotebookEdit", async () => {
    fs.writeFileSync(path.join(cwd, "a.ts"), "one\ntwo\n");
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(assistant(toolUse("e1", "Edit", { file_path: "a.ts", old_string: "two", new_string: "2" })));
    q.emit(assistant(toolUse("w1", "Write", { file_path: "new.ts", content: "fresh\n" })));
    q.emit(assistant(toolUse("m1", "MultiEdit", { file_path: "a.ts", edits: [{ old_string: "one", new_string: "1" }] })));
    q.emit(assistant(toolUse("n1", "NotebookEdit", { notebook_path: "n.ipynb", new_source: "cell" })));
    await flush();
    const items = thread("c1").filter((i): i is Extract<ThreadItem, { kind: "tool" }> => i.kind === "tool");
    expect(items[0]).toMatchObject({ kind: "tool", id: "e1", name: "Edit", file: "a.ts" });
    expect(items[0]?.edit?.file).toBe("a.ts");
    expect(items[0]?.edit?.added).toBe(1);
    expect(items[0]?.edit?.removed).toBe(1);
    expect(items[1]).toMatchObject({ kind: "tool", id: "w1", name: "Write", file: "new.ts" });
    expect(items[1]?.edit?.creates).toBe(true);
    expect(items[2]).toMatchObject({ kind: "tool", id: "m1", name: "MultiEdit", file: "a.ts" });
    expect(items[2]?.edit?.added).toBe(1);
    expect(items[3]).toMatchObject({ kind: "tool", id: "n1", name: "NotebookEdit", file: "n.ipynb" });
    expect(items[3]?.edit?.file).toBe("n.ipynb");
  });

  it("records the file on Read but no EditPreview", async () => {
    fs.writeFileSync(path.join(cwd, "r.ts"), "");
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(assistant(toolUse("r1", "Read", { file_path: "r.ts" })));
    await flush();
    const item = nth(thread("c1").filter((i): i is Extract<ThreadItem, { kind: "tool" }> => i.kind === "tool"), 0);
    expect(item).toMatchObject({ kind: "tool", id: "r1", name: "Read", file: "r.ts" });
    expect(item.edit).toBeUndefined();
  });

  it("leaves the file absolute when the path sits outside the card folder", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(assistant(toolUse("o1", "Read", { file_path: "/elsewhere/x.ts" })));
    await flush();
    const item = nth(thread("c1").filter((i): i is Extract<ThreadItem, { kind: "tool" }> => i.kind === "tool"), 0);
    expect(item.file).toBe("/elsewhere/x.ts");
  });

  it("leaves file and edit off tools that don't touch a file", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(assistant(toolUse("b1", "Bash", { command: "ls" })));
    await flush();
    const item = nth(thread("c1").filter((i): i is Extract<ThreadItem, { kind: "tool" }> => i.kind === "tool"), 0);
    expect(item.file).toBeUndefined();
    expect(item.edit).toBeUndefined();
  });

  it("survives a thrown editPreview so the turn still records the tool call", async () => {
    // editPreview reads files from disk; force it to throw so the catch in readFileEdit runs.
    // The thread item still records the call and its file, just without the edit preview.
    const preview = await import("./edit-preview");
    const spy = vi.spyOn(preview, "editPreview").mockImplementation(() => {
      throw new Error("disk on fire");
    });
    try {
      addCard({ id: "c1" });
      const q = await send("c1");
      q.emit(assistant(toolUse("b1", "Edit", { file_path: "a.ts", old_string: "x", new_string: "y" })));
      await flush();
      const item = nth(thread("c1").filter((i): i is Extract<ThreadItem, { kind: "tool" }> => i.kind === "tool"), 0);
      expect(item).toMatchObject({ kind: "tool", id: "b1", name: "Edit", file: "a.ts" });
      expect(item.edit).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("limit hits", () => {
  it("a refused request logs a limit hit for its window, once per reset; an allowed one logs none", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const limit = (info: Record<string, unknown>) => ({ type: "rate_limit_event", rate_limit_info: { status: "rejected", ...info } });
    q.emit(
      { type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: 0.5, resetsAt: 100 } },
      limit({ rateLimitType: "five_hour", utilization: 1, resetsAt: 300 }),
      limit({ rateLimitType: "seven_day_opus", resetsAt: 900 }),
      limit({ rateLimitType: "overage" }),
      limit({}),
    );
    await flush();
    // Only the plan's own windows are logged against the plan. A per-model cap ("seven_day_opus")
    // is that model's own limit and goes to the model store instead — filed as a plan window it
    // would gate every model on the account (lib/limit-kind.ts).
    expect(vi.mocked(recordLimit).mock.calls.map((c) => [c[0], c[2]?.id, c[3]])).toEqual([["five_hour", "c1", 300]]);
  });

  it("logs a per-model cap against the model, not against the plan", async () => {
    addCard({ id: "c1", model: "claude-opus-5-5" });
    const q = await send("c1");
    const limit = (info: Record<string, unknown>) => ({ type: "rate_limit_event", rate_limit_info: { status: "rejected", ...info } });
    q.emit(limit({ rateLimitType: "seven_day_opus", utilization: 1, resetsAt: 900 }));
    await flush();
    expect(vi.mocked(recordLimit).mock.calls.map((c) => c[0])).toEqual([]);
    expect(recorded.map((r) => [r.model, r.resetsAt])).toEqual([["claude-opus-5-5", 900 * 1000]]);
  });
});
