// A refused request is a plan-limit hit: lib/runner-turn.ts handleRateLimit logs it for the limit badges
// and the Wefter Profile's chart (lib/activity.ts recordLimit, lib/usage.ts), against the fake SDK.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
const logged = vi.hoisted(() => [] as unknown[][]);
vi.mock("./activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./activity")>()),
  recordLimit: (...args: unknown[]) => logged.push(args),
}));

let runner: typeof import("./runner");
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);

beforeEach(async () => {
  cwd = resetHarness(h);
  logged.length = 0;
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

it("logs a refused request as a hit of its window, with its reset; allowed ones and other windows aren't", async () => {
  addCard({ id: "c1" });
  runner.sendMessage("c1", "hello");
  await flush();
  const q = nth(h.queries, -1, "query");
  const limit = (info: Record<string, unknown>) => ({ type: "rate_limit_event", rate_limit_info: info });
  q.emit(
    limit({ status: "allowed", rateLimitType: "five_hour", utilization: 0.5 }),
    limit({ status: "rejected", rateLimitType: "five_hour", utilization: 1, resetsAt: 300 }),
    limit({ status: "rejected", rateLimitType: "seven_day_opus", resetsAt: 900 }),
    limit({ status: "rejected", rateLimitType: "overage" }),
    limit({ status: "rejected" }),
  );
  await flush();
  // Only the plan's own windows are logged against the plan. A per-model cap ("seven_day_opus")
  // is that model's own limit, so it goes to the model store and not here — filed as a plan window
  // it would gate every model on the account (lib/limit-kind.ts).
  expect(logged.map(([kind, , card, resetsAt]) => [kind, (card as Card).id, resetsAt])).toEqual([["five_hour", "c1", 300]]);
});

it("a reading that lands after the card switched CLI is logged under the CLI that sent it, and stays off the card", async () => {
  const recorded = vi.fn();
  vi.doMock("./limit-history", () => ({ recordLimits: recorded, setOnLimitReset: vi.fn() }));
  vi.resetModules();
  runner = await import("./runner");
  addCard({ id: "c1" });
  runner.sendMessage("c1", "hello");
  await flush();
  const q = nth(h.queries, -1, "query");
  const limit = (info: Record<string, unknown>) => ({ type: "rate_limit_event", rate_limit_info: info });
  q.emit(limit({ status: "allowed", rateLimitType: "five_hour", utilization: 0.4, resetsAt: 300 }));
  await flush();
  expect(recorded).toHaveBeenLastCalledWith("claude", { fiveHour: { used: 40, resetsAt: 300 } });
  expect(h.cards.get("c1")?.stats?.fiveHour).toEqual({ used: 40, resetsAt: 300 });
  // "Run on puku" flipped the card while the Claude session still had a reading on its way.
  h.cards.set("c1", { ...h.cards.get("c1")!, backend: "puku" });
  q.emit(limit({ status: "rejected", rateLimitType: "five_hour", utilization: 1, resetsAt: 300 }));
  await flush();
  expect(recorded).toHaveBeenLastCalledWith("claude", { fiveHour: { used: 100, resetsAt: 300 } });
  expect(h.cards.get("c1")?.stats?.fiveHour).toEqual({ used: 40, resetsAt: 300 });
  vi.doUnmock("./limit-history");
});
