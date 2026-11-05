// The runner's side of Settings' "Use … for subagents" (lib/subagents.ts): the prompt and env a thread's
// CLI starts with, and idle sessions replaced when the setting changes. Same harness as lib/runner.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendEnv } from "./puku-idle";
import { flush, makeCard, nth, resetHarness, success } from "./runner.harness";
import type { Card } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

let runner: typeof import("./runner");
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const lastQuery = () => nth(h.queries, -1, "query");

async function send(id: string, msg = "hello") {
  runner.sendMessage(id, msg);
  await flush();
  return lastQuery();
}

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("subagents", () => {
  it("asks threads to delegate, with a model guide when the thread chooses", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    expect((q.options.systemPrompt as { append: string }).append).toMatch(/Use subagents[\s\S]*When unsure, pick sonnet[\s\S]*THREAD PROMPT/);
    expect(q.options.env).toEqual({ PATH: "/usr/bin" });
  });

  it("forces a model the thread's CLI serves through its env; the other CLI's runs headless; not on the copilot", async () => {
    h.subagentModel = "claude-haiku-5-5";
    addCard({ id: "c1" });
    addCard({ id: "pk", backend: "puku" });
    addCard({ id: "cp", role: "copilot" });
    const q = await send("c1");
    expect(q.options.env).toEqual({ PATH: "/usr/bin", CLAUDE_CODE_SUBAGENT_MODEL: "claude-haiku-5-5", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" });
    expect((q.options.systemPrompt as { append: string }).append).toContain("Subagents run on Haiku 5.5 (Claude)");
    const pk = await send("pk");
    expect(pk.options.env).toEqual({ PATH: "/usr/bin", ...backendEnv("puku", {}) });
    expect((pk.options.systemPrompt as { append: string }).append).toContain("claude -p");
    expect((await send("cp")).options.env).toEqual({ PATH: "/usr/bin" });
  });

  it("gives a puku thread a Puku subagent model through puku-cli's env", async () => {
    h.subagentModel = "puku-ai-2.7";
    addCard({ id: "pk", backend: "puku" });
    expect((await send("pk")).options.env).toEqual({ PATH: "/usr/bin", ...backendEnv("puku", {}), PUKU_CLI_SUBAGENT_MODEL: "puku-ai-2.7" });
  });

  it("an idle session is replaced when the subagent model changes in Settings", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success("ok"));
    await flush();
    h.subagentModel = "claude-opus-5-5";
    runner.sendMessage("c1", "next");
    expect(q.aborted).toBe(true);
    await flush();
    expect(lastQuery().options.env).toMatchObject({ CLAUDE_CODE_SUBAGENT_MODEL: "claude-opus-5-5" });
  });
});
