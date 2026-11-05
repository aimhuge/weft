// @vitest-environment node
// Auto mode's classifier denials (lib/classifier-denial.ts) through the runner, against the fake SDK in lib/runner.harness.ts.
import type { HookCallbackMatcher, HookInput, Options } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness, success } from "./runner.harness";
import type { Card, ThreadItem } from "./types";

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
const card = (id: string) => h.cards.get(id)!;
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];
const lastQuery = () => nth(h.queries, -1, "query");

const MIGRATE = "mcp__supabase__apply_migration";
const input = { name: "add_x", query: "create table x ()" };
const denied = {
  type: "system",
  subtype: "permission_denied",
  tool_name: MIGRATE,
  tool_use_id: "tu1",
  decision_reason_type: "classifier",
  decision_reason: "Applying a migration to production",
  message: "Denied by auto mode",
};
const deniedResult = (text: string) => success(text, { permission_denials: [{ tool_name: MIGRATE, tool_use_id: "tu1", tool_input: input }] });

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

async function deniedTurn() {
  addCard({ id: "c1", permissionMode: "auto" });
  runner.sendMessage("c1", "apply it");
  await flush();
  lastQuery().emit(denied, deniedResult("It was blocked; approve it"));
  await flush();
}

describe("a classifier denial", () => {
  it("parks the card in Needs you with the tool, the classifier's reason and the call", async () => {
    await deniedTurn();
    expect(card("c1")).toMatchObject({
      column: "needs_you",
      pending: { toolName: MIGRATE, input, why: { category: "classifier", detail: "Applying a migration to production" } },
    });
    expect(thread("c1")).toContainEqual(expect.objectContaining({ kind: "permission", toolName: MIGRATE }));
  });

  it("Allow once and retry tells the thread to retry, and lets that exact call through once", async () => {
    await deniedTurn();
    const q = lastQuery();
    runner.answerPermission("c1", true);
    await flush();
    expect(card("c1").column).toBe("running");
    expect(q.received.at(-1)).toMatch(/Retry exactly that call now/);
    // Clicking Allow leaves the session in auto mode: its other calls, background subagents' too, aren't asked about.
    expect(q.setPermissionMode).not.toHaveBeenCalled();
    const opts = (q.options as unknown as Options).hooks ?? {};
    const pre: HookCallbackMatcher[] = opts.PreToolUse ?? [];
    const post: HookCallbackMatcher[] = opts.PostToolUse ?? [];
    const grant = nth(nth(pre, -1).hooks, 0);
    const ran = nth(nth(post, -1).hooks, 0);
    const call = (tool_use_id: string) => ({ hook_event_name: "PreToolUse", tool_name: MIGRATE, tool_input: input, tool_use_id }) as HookInput;
    const signal = new AbortController().signal;
    // The retry's own hook steps the CLI out of auto mode for just that call, so its allow counts.
    expect(await grant(call("tu2"), "tu2", { signal })).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(q.setPermissionMode).toHaveBeenLastCalledWith("default");
    // Another call waits until the CLI is back in auto mode, which it is once the retry has run.
    const other = grant({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls /tmp/x" }, tool_use_id: "o1" } as HookInput, "o1", { signal });
    await ran({ hook_event_name: "PostToolUse", tool_use_id: "tu2" } as HookInput, "tu2", { signal });
    expect(await other).toEqual({});
    expect(q.setPermissionMode).toHaveBeenLastCalledWith("auto");
    // Spent: the same call isn't let through again.
    expect(await grant(call("tu3"), "tu3", { signal })).toEqual({});
  });

  it("Keep denied puts the card back in the column the turn ended in", async () => {
    await deniedTurn();
    runner.answerPermission("c1", false);
    await flush();
    expect(card("c1")).toMatchObject({ column: "review", pending: null });
    expect(lastQuery().received).toHaveLength(1);
  });

  it("a reply instead of a click moves on from the prompt", async () => {
    await deniedTurn();
    runner.sendMessage("c1", "never mind");
    await flush();
    expect(card("c1")).toMatchObject({ column: "running", pending: null });
    expect(thread("c1")).toContainEqual(expect.objectContaining({ kind: "permission", toolName: MIGRATE, decision: "deny" }));
  });
});
