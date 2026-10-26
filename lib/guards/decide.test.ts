import type { HookCallbackMatcher, HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { decide, matches, type GuardCall, type GuardEvent } from "./decide";
import type { GuardHooks } from "./hooks";

// What Weft's guards make of one tool call (lib/guards/decide.ts): which hooks a matcher takes, and how their words
// fold into one verdict — deny wins over ask, ask over allow, and a call nothing said anything about is allowed.

const signal = new AbortController().signal;

/** A guard set of one matcher per hook, each hook saying what it says. */
function hooksWith(event: GuardEvent, entries: { matcher?: string; says: HookJSONOutput | Record<string, unknown> }[]): GuardHooks {
  const list: HookCallbackMatcher[] = entries.map((entry) => ({
    matcher: entry.matcher,
    hooks: [() => Promise.resolve(entry.says as HookJSONOutput)],
  }));
  return { [event]: list };
}

function call(over: Partial<GuardCall> = {}): GuardCall {
  return { event: "PreToolUse", tool: "Bash", input: { command: "ls" }, cwd: "/proj", id: "t1", ...over };
}

describe("matches", () => {
  it("takes every tool for no matcher at all or for the star", () => {
    expect(matches(undefined, "Bash")).toBe(true);
    expect(matches("", "Bash")).toBe(true);
    expect(matches("*", "Bash")).toBe(true);
    expect(matches("*", "mcp__server__tool")).toBe(true);
  });

  it("takes the plain names a matcher lists, joined by |", () => {
    expect(matches("Bash", "Bash")).toBe(true);
    expect(matches("Bash", "Read")).toBe(false);
    expect(matches("Read|Edit|Bash", "Edit")).toBe(true);
    expect(matches("Read|Edit|Bash", "Write")).toBe(false);
  });

  it("takes what a regular expression over the whole name matches", () => {
    expect(matches(".*", "Bash")).toBe(true);
    expect(matches("mcp__.*__tool", "mcp__server__tool")).toBe(true);
    expect(matches("mcp__.*__tool", "Bash")).toBe(false);
    expect(matches("Bash|Read", "Bash")).toBe(true);
  });

  it("takes nothing when the matcher isn't a regular expression at all", () => {
    expect(matches("Bash(", "Bash")).toBe(false);
    expect(matches("[", "Bash")).toBe(false);
  });
});

describe("decide", () => {
  it("lets a call through when no hook says anything about it", async () => {
    const verdict = await decide({}, call(), signal);
    expect(verdict).toEqual({ decision: "allow" });
  });

  it("lets a call through when no hook of the call's event matches its tool", async () => {
    const hooks = hooksWith("PreToolUse", [{ matcher: "Read", says: { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "no" } } }]);
    expect(await decide(hooks, call({ tool: "Bash" }), signal)).toEqual({ decision: "allow" });
  });

  it("runs only the hooks of the call's own event", async () => {
    const pre = hooksWith("PreToolUse", [{ matcher: "*", says: { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "pre says no" } } }]);
    const post = hooksWith("PostToolUse", [{ matcher: "*", says: { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "post says no" } } }]);
    const both = { ...pre, ...post } as GuardHooks;
    expect(await decide(both, call({ event: "PreToolUse" }), signal)).toEqual({ decision: "deny", reason: "pre says no" });
    expect(await decide(both, call({ event: "PostToolUse" }), signal)).toEqual({ decision: "deny", reason: "post says no" });
  });

  it("turns a call away when any hook denies it, and the first denial is the reason", async () => {
    const hooks = hooksWith("PreToolUse", [
      { matcher: "*", says: { hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "may I?" } } },
      { matcher: "*", says: { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "first refusal" } } },
      { matcher: "*", says: { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "second refusal" } } },
    ]);
    expect(await decide(hooks, call(), signal)).toEqual({ decision: "deny", reason: "first refusal" });
  });

  it("says its own reason when the hook that denies it gives none", async () => {
    const hooks = hooksWith("PreToolUse", [{ matcher: "*", says: { hookSpecificOutput: { permissionDecision: "deny" } } }]);
    expect(await decide(hooks, call(), signal)).toEqual({ decision: "deny", reason: "Weft's guards turned this call away." });
  });

  it("asks when a hook asks and none denies it", async () => {
    const hooks = hooksWith("PreToolUse", [
      { matcher: "*", says: { hookSpecificOutput: { permissionDecision: "allow" } } },
      { matcher: "*", says: { hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "may I?" } } },
    ]);
    expect(await decide(hooks, call(), signal)).toEqual({ decision: "ask", reason: "may I?" });
  });

  it("says its own reason when the hook that asks gives none", async () => {
    const hooks = hooksWith("PreToolUse", [{ matcher: "*", says: { hookSpecificOutput: { permissionDecision: "ask" } } }]);
    expect(await decide(hooks, call(), signal)).toEqual({ decision: "ask", reason: "Weft's guards ask before this call." });
  });

  it("allows a call and joins what the hooks wanted the model to know", async () => {
    const hooks = hooksWith("PreToolUse", [
      { matcher: "*", says: { hookSpecificOutput: { permissionDecision: "allow", additionalContext: "one card owns this." } } },
      { matcher: "*", says: { hookSpecificOutput: { additionalContext: "two cards own this." } } },
    ]);
    expect(await decide(hooks, call(), signal)).toEqual({ decision: "allow", context: "one card owns this.\n\ntwo cards own this." });
  });

  it("tells the model what a blocking hook said, and the words of each are joined", async () => {
    const hooks = hooksWith("PostToolUse", [
      { matcher: "*", says: { decision: "block", reason: "the import broke." } },
      { matcher: "*", says: { decision: "block", reason: "the test failed." } },
    ]);
    expect(await decide(hooks, call({ event: "PostToolUse" }), signal)).toEqual({ decision: "allow", feedback: "the import broke.\n\nthe test failed." });
  });

  it("says nothing about a blocking hook that gave no reason", async () => {
    const hooks = hooksWith("PostToolUse", [{ matcher: "*", says: { decision: "block" } }]);
    expect(await decide(hooks, call({ event: "PostToolUse" }), signal)).toEqual({ decision: "allow" });
  });

  it("ignores a hook that answers later, on its own", async () => {
    const hooks = hooksWith("PreToolUse", [{ matcher: "*", says: { async: true } }]);
    expect(await decide(hooks, call(), signal)).toEqual({ decision: "allow" });
  });

  it("ignores what isn't an object at all", async () => {
    const hooks = hooksWith("PreToolUse", [{ matcher: "*", says: undefined as unknown as Record<string, unknown> }]);
    expect(await decide(hooks, call(), signal)).toEqual({ decision: "allow" });
  });

  it("reads a reason given at the top level of the hook's answer", async () => {
    const hooks = hooksWith("PreToolUse", [{ matcher: "*", says: { decision: "block", reason: "not that way" } }]);
    expect(await decide(hooks, call(), signal)).toEqual({ decision: "allow", feedback: "not that way" });
  });
});

describe("what a hook is given", () => {
  it("tells a PreToolUse hook the call, the folder and the call's id", async () => {
    let seen: HookInput | undefined;
    const hooks = {
      PreToolUse: [{ matcher: "*", hooks: [(input) => { seen = input; return Promise.resolve({}); }] }] as HookCallbackMatcher[],
    } as GuardHooks;
    await decide(hooks, call({ event: "PreToolUse", input: { command: "ls" }, cwd: "/proj", id: "t9" }), signal);
    expect(seen).toMatchObject({
      session_id: "",
      transcript_path: "",
      cwd: "/proj",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_use_id: "t9",
      hook_event_name: "PreToolUse",
    });
    expect(seen).not.toHaveProperty("tool_response");
    expect(seen).not.toHaveProperty("error");
  });

  it("tells a PostToolUse hook what the call returned", async () => {
    let seen: HookInput | undefined;
    const hooks = {
      PostToolUse: [{ matcher: "*", hooks: [(input) => { seen = input; return Promise.resolve({}); }] }] as HookCallbackMatcher[],
    } as GuardHooks;
    await decide(hooks, call({ event: "PostToolUse", response: { stdout: "hi" } }), signal);
    expect(seen).toMatchObject({ hook_event_name: "PostToolUse", tool_response: { stdout: "hi" } });
    expect(seen).not.toHaveProperty("error");
  });

  it("tells a PostToolUseFailure hook why the call failed", async () => {
    let seen: HookInput | undefined;
    const hooks = {
      PostToolUseFailure: [{ matcher: "*", hooks: [(input) => { seen = input; return Promise.resolve({}); }] }] as HookCallbackMatcher[],
    } as GuardHooks;
    await decide(hooks, call({ event: "PostToolUseFailure", error: "exit 1" }), signal);
    expect(seen).toMatchObject({ hook_event_name: "PostToolUseFailure", error: "exit 1" });
    expect(seen).not.toHaveProperty("tool_response");
  });

  it("tells a PostToolUseFailure hook of a failure with no reason at all", async () => {
    let seen: HookInput | undefined;
    const hooks = {
      PostToolUseFailure: [{ matcher: "*", hooks: [(input) => { seen = input; return Promise.resolve({}); }] }] as HookCallbackMatcher[],
    } as GuardHooks;
    await decide(hooks, call({ event: "PostToolUseFailure" }), signal);
    expect(seen).toMatchObject({ hook_event_name: "PostToolUseFailure", error: "" });
  });
});
