// @vitest-environment node
// A card's agent (lib/agents.ts) picks the soul its CLI starts with, against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPYWRITER_SOUL_PROMPT, WEFT_SOUL_PROMPT } from "./agents";
import { flush, makeCard, nth, resetHarness } from "./runner.harness";
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
const soulOf = (q: unknown) => (q as { options: { systemPrompt: { append: string } } }).options.systemPrompt.append;

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("a card's agent", () => {
  it("starts a copywriter's CLI with the copywriter's soul, and a plain card's with Weft's", async () => {
    addCard({ id: "c1", agent: "copywriter" });
    runner.sendMessage("c1", "write the intro");
    await flush();
    expect(soulOf(nth(h.queries, -1, "query")).startsWith(COPYWRITER_SOUL_PROMPT)).toBe(true);
    addCard({ id: "c2" });
    runner.sendMessage("c2", "build it");
    await flush();
    expect(soulOf(nth(h.queries, -1, "query")).startsWith(WEFT_SOUL_PROMPT)).toBe(true);
  });

  it("never takes a spare, whose CLI started with Builder's soul", async () => {
    const { adoptSpare } = await import("./runner-session");
    addCard({ id: "c1", agent: "copywriter" });
    expect(adoptSpare(h.cards.get("c1")!)).toBeUndefined();
  });

  it("rides on the spec, for the copilot never", async () => {
    const { specFor } = await import("./runner-state");
    expect(specFor(addCard({ id: "c1", agent: "copywriter" })).agent).toBe("copywriter");
    expect(specFor(addCard({ id: "c2", agent: "copywriter", role: "copilot" })).agent).toBeUndefined();
  });
});
