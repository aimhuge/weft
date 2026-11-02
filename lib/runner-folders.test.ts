// @vitest-environment node
// The folder gate's prompts and grants through a thread's canUseTool (lib/folder-guard.ts, lib/runner-session.ts),
// against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness, type FakeQuery } from "./runner.harness";
import type { Card } from "./types";

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
const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;

async function send(id: string) {
  runner.sendMessage(id, "hello");
  await flush();
  return nth(h.queries, -1, "query");
}

const ask = (q: FakeQuery, toolName: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  q.options.canUseTool(toolName, input, { signal: new AbortController().signal, ...extra });

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("the CLI's working directories", () => {
  it("gives a worker's session the show folder, beside the card's own grants", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    const { SHOW_DIR } = await import("./show-dir");
    addCard({ id: "c1", readScope: ["/Users/zzz-outside"] });
    const q = await send("c1");
    expect(q.options.additionalDirectories).toEqual(["/Users/zzz-outside", SHOW_DIR]);
  });

  it("gives a desktop session the show folder too", async () => {
    const { SHOW_DIR } = await import("./show-dir");
    addCard({ id: "c1", readScope: ["/Users/zzz-outside"] });
    expect((await send("c1")).options.additionalDirectories).toEqual(["/Users/zzz-outside", SHOW_DIR]);
  });
});

describe("folder gate", () => {
  it("a call outside the project asks in the folder gate's words and carries the folder its buttons grant", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const input = { file_path: "/Users/zzz-outside/a.mp3" };
    // The runner is reloaded per test, so the guard is taken from the same registry.
    const { folderGuard } = await import("./folder-guard");
    await folderGuard(() => "c1")({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: input, cwd: "/work" } as never, "u-out", { signal: new AbortController().signal });
    const promise = ask(q, "Read", input, { toolUseID: "u-out" });
    expect(card("c1")).toMatchObject({
      column: "needs_you",
      pending: { title: "Outside the project: read /Users/zzz-outside", why: { category: "outside" }, readScope: { directory: "/Users/zzz-outside", token: "/Users/zzz-outside" } },
    });
    runner.answerPermission("c1", true);
    await expect(promise).resolves.toMatchObject({ behavior: "allow" });
  });

  it("a read in a folder the card was granted goes through without a prompt", async () => {
    addCard({ id: "c1", readScope: ["/Users/zzz-outside"] });
    const q = await send("c1");
    const promise = ask(q, "Read", { file_path: "/Users/zzz-outside/a.mp3" });
    await expect(promise).resolves.toEqual({ behavior: "allow", updatedInput: { file_path: "/Users/zzz-outside/a.mp3" } });
    expect(card("c1").pending).toBeFalsy();
  });
});
