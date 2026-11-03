// @vitest-environment node
// Vault values in stored tool results: lib/runner.ts asks Electron main (lib/secret-run.ts) to swap them for
// ‹NAME› before a secrets-using card's results are written, against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistant, flush, makeCard, nth, resetHarness, toolResultMsg, toolUse } from "./runner.harness";
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

const REDACT_URL = "http://127.0.0.1:4567/secrets/redact";
// Main's side: swaps the one known value.
const fetchMock = vi.fn((_url: string, init: RequestInit) => {
  const { text } = JSON.parse(init.body as string) as { text: string };
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ text: text.replace("hunter2-secret", "‹DB_PASS›") }) });
});

let runner: typeof import("./runner");
let cwd: string;
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];
const toolItem = (id: string) => thread(id).find((i) => i.kind === "tool");

async function send(id: string) {
  runner.sendMessage(id, "hello");
  await flush();
  return nth(h.queries, -1, "query");
}

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  delete (globalThis as Record<string, unknown>).__weftSecretsInUse;
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("tool results of a card that used vault secrets", () => {
  it("are stored with each value swapped for ‹NAME›", async () => {
    (await import("./secret-run")).markInUse("c1");
    makeCard(h, cwd, { id: "c1" });
    const q = await send("c1");
    q.emit(assistant(toolUse("t1", "Bash", { command: "cat log" })));
    q.emit(toolResultMsg("t1", "password hunter2-secret"));
    q.emit(toolResultMsg("nope", "ignored"));
    await flush(3);
    expect(toolItem("c1")).toMatchObject({ id: "t1", result: "password ‹DB_PASS›", isError: false });
    expect(fetchMock).toHaveBeenCalledWith(REDACT_URL, expect.objectContaining({ method: "POST" }));
  });

  it("aren't sent to main for a card that never used secrets", async () => {
    makeCard(h, cwd, { id: "c2" });
    const q = await send("c2");
    q.emit(assistant(toolUse("t2", "Bash", { command: "ls" })));
    q.emit(toolResultMsg("t2", "hunter2-secret"));
    await flush();
    expect(toolItem("c2")).toMatchObject({ result: "hunter2-secret" });
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(REDACT_URL);
  });
});

describe("a thread's ask for a key", () => {
  it("is marked on its tool item, so the thread draws an input there", async () => {
    makeCard(h, cwd, { id: "c3" });
    const q = await send("c3");
    q.emit(assistant(toolUse("t3", "mcp__secrets__ask_add", { name: "SUPABASE_SECRET_KEY", environment: "preview" })));
    q.emit(toolResultMsg("t3", "ok"));
    await flush(3);
    expect(toolItem("c3")).toMatchObject({ id: "t3", result: "ok", ask: { folder: cwd, name: "SUPABASE_SECRET_KEY", environment: "preview" } });
  });

  it("is marked on a worker card too: the Mac draws the input against its own checkout of the repo", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    vi.stubEnv("WEFT_SHELL_URL", "");
    makeCard(h, cwd, { id: "c5" });
    const q = await send("c5");
    q.emit(assistant(toolUse("t5", "mcp__secrets__ask_add", { name: "SUPABASE_SECRET_KEY" })));
    await flush();
    vi.unstubAllEnvs();
    expect(toolItem("c5")).toMatchObject({ id: "t5", ask: { folder: cwd, name: "SUPABASE_SECRET_KEY", environment: "development" } });
  });

  it("isn't marked when the name can't be a secret's", async () => {
    makeCard(h, cwd, { id: "c4" });
    const q = await send("c4");
    q.emit(assistant(toolUse("t4", "mcp__secrets__ask_add", { name: "1 bad" })));
    await flush();
    expect(toolItem("c4")).toMatchObject({ id: "t4" });
    expect(toolItem("c4")).not.toHaveProperty("ask");
  });
});
