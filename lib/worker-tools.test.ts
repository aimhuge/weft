import { afterEach, describe, expect, it, vi } from "vitest";
import { groupWorks, WORKER_TOOL_GATE, WORKER_TOOLS, workerToolGap, workerToolsPrompt } from "./worker-tools";

afterEach(() => vi.unstubAllEnvs());

const call = (tool_name: string, hook_event_name = "PreToolUse") => (WORKER_TOOL_GATE.hooks[0] as (i: unknown, id?: string, o?: unknown) => Promise<unknown>)({ hook_event_name, tool_name, tool_input: {} }, "t", { signal: new AbortController().signal });

describe("workerToolGap", () => {
  it("names why a tool doesn't work on a worker, and nothing for one that does", () => {
    expect(workerToolGap("mcp__browser__open_url")).toBeNull();
    expect(workerToolGap("mcp__browser__screenshot")).toMatch(/browser pane/);
    expect(workerToolGap("mcp__secrets__run")).toMatch(/vault/);
    expect(workerToolGap("mcp__webhooks__add_blank")).toBeNull();
    expect(workerToolGap("mcp__webhooks__relay")).toMatch(/tunnel/);
    expect(workerToolGap("mcp__board_view__click")).toMatch(/Weft's own window/);
    expect(workerToolGap("mcp__board__create_card")).toBeNull();
    expect(workerToolGap("mcp__board__restart_weft_when_idle")).toMatch(/no Weft app/);
  });

  it("leaves alone what isn't one of Weft's servers, and a server with no default", () => {
    expect(workerToolGap("Bash")).toBeNull();
    expect(workerToolGap("mcp__supabase__query")).toBeNull();
    expect(workerToolGap("mcp__x__y", { x: { z: "no" } })).toBeNull();
  });
});

describe("groupWorks", () => {
  it("is true when any of a group's tools works, or for a group the table doesn't know", () => {
    expect([groupWorks("webhooks"), groupWorks("devservers"), groupWorks("secrets"), groupWorks("gog"), groupWorks("other")]).toEqual([true, true, false, false, true]);
  });
});

describe("workerToolsPrompt", () => {
  it("lists every tool that doesn't work with why, and what the board tools do here", () => {
    const text = workerToolsPrompt();
    expect(text).toContain("- mcp__browser__* (all but open_url): the browser pane");
    expect(text).toContain("- mcp__secrets__*: the 🔐 vault");
    expect(text).toContain("- mcp__board__restart_weft_when_idle:");
    expect(text).toContain("- the gog CLI:");
    expect(text).toContain("create_card starts a card here");
    expect(workerToolsPrompt({ a: { "*": true } })).not.toContain("- ");
  });

  it("follows the table: flipping a tool to true takes it off the list", () => {
    const table = { ...WORKER_TOOLS, secrets: { "*": true as const } };
    expect(workerToolsPrompt(table)).not.toContain("mcp__secrets__");
  });
});

describe("WORKER_TOOL_GATE", () => {
  it("denies a tool that doesn't work, on a worker only", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    const denied = (await call("mcp__secrets__list")) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(denied.hookSpecificOutput.permissionDecisionReason).toMatch(/^secrets__list doesn't work on a Weft Worker yet: the 🔐 vault/);
    expect(await call("mcp__board__list_cards")).toEqual({});
    expect(await call("mcp__secrets__list", "PostToolUse")).toEqual({});
    vi.stubEnv("WEFT_WORKER", "");
    expect(await call("mcp__secrets__list")).toEqual({});
  });
});
