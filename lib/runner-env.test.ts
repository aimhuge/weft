// @vitest-environment node
// Each message a thread's CLI gets starts with the <weft-env> block (lib/turn-env.ts); the thread shows only what was typed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, init, makeCard, nth, resetHarness, success } from "./runner.harness";
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

type Runner = typeof import("./runner");
let runner: Runner;
let turnClient: typeof import("./turn-client");
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const lastQuery = () => nth(h.queries, -1, "query");

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
  turnClient = await import("./turn-client");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("the <weft-env> block", () => {
  it("goes ahead of each message with its sender, and the thread shows just what was typed", async () => {
    addCard({ id: "c1" });
    turnClient.noteClient("c1", { app: "web", tz: "Asia/Bangkok" });
    runner.sendMessage("c1", "hello");
    await flush();
    const q = lastQuery();
    const first = nth(q.raw, 0, "message");
    expect(first).toMatch(/^<weft-env>\nhost: your Mac \(.+\), .+, Weft \S+.*\nfrom: weft\.zip in a browser\ntime: .*Asia\/Bangkok \(UTC\+07:00\).*\n<\/weft-env>\n\nhello$/);
    expect(h.threads.get("c1")?.[0]).toMatchObject({ kind: "user", text: "hello" });

    q.emit(init(), success("done"));
    await flush();
    runner.sendMessage("c1", "again");
    await flush();
    expect(nth(q.raw, 1, "message")).toContain("from: Weft itself");
  });

  it("stays out of a /command's way", async () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "/weft:done");
    await flush();
    expect(nth(lastQuery().raw, 0, "message")).toBe("/weft:done");
  });
});
