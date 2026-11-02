import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "./runner-state";

const appendThread = vi.fn(() => 7);
const replaceThreadItem = vi.fn();
const safeUpdate = vi.fn();
const sendMessage = vi.fn();

vi.mock("./store", () => ({ appendThread, replaceThreadItem }));
vi.mock("./runner-state", () => ({ safeUpdate, hooks: { send: sendMessage } }));
vi.mock("./runner-pending", () => ({ pendingView: (p: { id: string; title: string; why?: unknown }) => ({ id: p.id, title: p.title, why: p.why }) }));

const { askAboutDenials, callKey, dropDenialPrompts, noteDenial, outOfAutoAnswer, retryMessage, takeGrant, withRetryGrant } = await import("./classifier-denial");

const MIGRATE = "mcp__supabase__apply_migration";
const input = { name: "add_x", query: "create table x ()" };

function denied(over: Record<string, unknown> = {}) {
  return {
    type: "system",
    subtype: "permission_denied",
    tool_name: MIGRATE,
    tool_use_id: "tu1",
    decision_reason_type: "classifier",
    decision_reason: "Looks like a production deploy",
    message: "Permission denied",
    uuid: "00000000-0000-0000-0000-000000000000",
    session_id: "s",
    ...over,
  } as Parameters<typeof noteDenial>[1];
}

function session(): Session {
  return { pending: [], spec: { permissionMode: "default" } } as unknown as Session;
}

beforeEach(() => vi.clearAllMocks());

describe("noteDenial", () => {
  it("keeps a classifier denial, with its reason", () => {
    const s = session();
    noteDenial(s, denied());
    expect(s.denials).toEqual([{ toolUseId: "tu1", toolName: MIGRATE, reason: "Looks like a production deploy" }]);
  });

  it("falls back to the message, and skips other deciders and subagents' calls", () => {
    const s = session();
    noteDenial(s, denied({ decision_reason: undefined }));
    noteDenial(s, denied({ decision_reason_type: "rule" }));
    noteDenial(s, denied({ agent_id: "a1" }));
    expect(s.denials).toEqual([{ toolUseId: "tu1", toolName: MIGRATE, reason: "Permission denied" }]);
  });
});

describe("callKey", () => {
  it("matches the same input whatever order its keys come in", () => {
    expect(callKey("T", { b: [1, { d: 1, c: 2 }], a: null })).toBe(callKey("T", { a: null, b: [1, { c: 2, d: 1 }] }));
    expect(callKey("T", { a: 1 })).not.toBe(callKey("U", { a: 1 }));
  });
});

describe("askAboutDenials", () => {
  it("puts a prompt on the card in Needs you with the tool, the reason and the call's input", () => {
    const s = session();
    noteDenial(s, denied());
    expect(askAboutDenials("c1", s, [{ tool_name: MIGRATE, tool_use_id: "tu1", tool_input: input }], "review")).toBe(true);
    const p = nth(s.pending, 0);
    expect(p).toMatchObject({ index: 7, toolName: MIGRATE, input, why: { category: "classifier", detail: "Looks like a production deploy" } });
    expect(p.title).toMatch(/^Auto mode blocked supabase apply_migration/);
    expect(appendThread).toHaveBeenCalledWith("c1", expect.objectContaining({ kind: "permission", toolName: MIGRATE }));
    expect(safeUpdate).toHaveBeenCalledWith("c1", expect.objectContaining({ column: "needs_you", lastLine: p.title }));
    expect(s.denials).toBeUndefined();
  });

  it("says the classifier denied it when the CLI gave no reason, and leaves out an empty summary", () => {
    const s = session();
    noteDenial(s, denied({ decision_reason: "", message: "" }));
    askAboutDenials("c1", s, [{ tool_name: MIGRATE, tool_use_id: "tu1", tool_input: {} }], "review");
    expect(s.pending[0]?.why).toEqual({ category: "classifier", detail: "Auto mode's classifier denied this call" });
    expect(s.pending[0]?.title).toBe("Auto mode blocked supabase apply_migration");
  });

  it("asks once per distinct call, and not at all for a stopped turn or none", () => {
    const s = session();
    noteDenial(s, denied());
    noteDenial(s, denied({ tool_use_id: "tu2" }));
    askAboutDenials("c1", s, [], "review");
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]?.input).toEqual({});
    const stopped = session();
    noteDenial(stopped, denied());
    expect(askAboutDenials("c1", stopped, [], "review", false)).toBe(false);
    expect(stopped.denials).toBeUndefined();
    expect(askAboutDenials("c1", session(), [], "review")).toBe(false);
    expect(safeUpdate).toHaveBeenCalledTimes(1);
  });

  it("spends an unused grant from the last retry", () => {
    const s = session();
    s.retryGrants = ["old"];
    askAboutDenials("c1", s, [], "review");
    expect(s.retryGrants).toBeUndefined();
  });
});

describe("answering the prompt", () => {
  function asked(...ids: string[]) {
    const s = session();
    for (const id of ids) noteDenial(s, denied({ tool_use_id: id, tool_name: id === "tu1" ? MIGRATE : "Bash" }));
    askAboutDenials("c1", s, [{ tool_name: MIGRATE, tool_use_id: "tu1", tool_input: input }], "review");
    return s;
  }
  // What settle() (lib/runner-pending.ts) does: take it off the queue, then resolve it.
  function answer(s: Session, allow: boolean) {
    const p = s.pending.shift()!;
    p.resolve(allow ? { behavior: "allow", updatedInput: p.input } : { behavior: "deny", message: "no" });
  }

  it("Allow once and retry grants that exact call and tells the thread to retry it", () => {
    const s = asked("tu1");
    answer(s, true);
    expect(s.retryGrants).toEqual([callKey(MIGRATE, input)]);
    expect(sendMessage).toHaveBeenCalledWith("c1", retryMessage([MIGRATE]));
  });

  it("Keep denied puts the card back where the turn left it", () => {
    const s = asked("tu1");
    answer(s, false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(safeUpdate).toHaveBeenLastCalledWith("c1", expect.objectContaining({ column: "review", pending: null }));
  });

  it("waits for the last prompt, then retries what was allowed", () => {
    const s = asked("tu1", "tu2");
    answer(s, true);
    expect(sendMessage).not.toHaveBeenCalled();
    answer(s, false);
    expect(sendMessage).toHaveBeenCalledWith("c1", retryMessage([MIGRATE]));
  });

  it("shows an error instead of throwing when the retry can't be sent", () => {
    sendMessage.mockImplementationOnce(() => {
      throw new Error("No such card.");
    });
    const s = asked("tu1");
    answer(s, true);
    expect(safeUpdate).toHaveBeenLastCalledWith("c1", { column: "review", error: "No such card." });
  });

  it("shows a thrown non-Error as text", () => {
    sendMessage.mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- what a non-Error throw looks like
      throw "closing";
    });
    const s = asked("tu1");
    answer(s, true);
    expect(safeUpdate).toHaveBeenLastCalledWith("c1", { column: "review", error: "closing" });
  });
});

describe("a retry in auto mode", () => {
  // In auto mode the CLI sends an MCP tool's hook allow on to the classifier, so the granted call's own hook steps
  // the live CLI out of auto mode for just that call (lib/retry-window.ts); the rest of the session stays in auto.
  function live(mode = "auto") {
    const setPermissionMode = vi.fn(() => Promise.resolve());
    const s = session();
    s.spec = { permissionMode: mode } as Session["spec"];
    s.query = { setPermissionMode } as unknown as Session["query"];
    noteDenial(s, denied());
    askAboutDenials("c1", s, [{ tool_name: MIGRATE, tool_use_id: "tu1", tool_input: input }], "review");
    s.pending.shift()!.resolve({ behavior: "allow", updatedInput: input });
    return { s, setPermissionMode };
  }
  const opts = (s: Session) => withRetryGrant({ env: {} }, s).hooks ?? {};
  const signal = { signal: new AbortController().signal };
  const pre = (s: Session, tool_name: string, tool_input: unknown, tool_use_id: string) =>
    nth(nth(opts(s).PreToolUse ?? [], 0).hooks, 0)({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id } as HookInput, undefined, signal);
  const post = (s: Session, hook_event_name: "PostToolUse" | "PostToolUseFailure", tool_use_id: string) =>
    nth(nth(opts(s)[hook_event_name] ?? [], 0).hooks, 0)({ hook_event_name, tool_use_id } as HookInput, undefined, signal);

  it("stays in auto mode when you allow the call: the retry is sent, the session doesn't step out", () => {
    const { s, setPermissionMode } = live();
    expect(sendMessage).toHaveBeenCalledWith("c1", retryMessage([MIGRATE]));
    expect(setPermissionMode).not.toHaveBeenCalled();
    expect(s.retryWindow).toBeUndefined();
  });

  it("steps out for the granted call only, allows it, and goes back to auto once it has run", async () => {
    const { s, setPermissionMode } = live();
    expect(await pre(s, MIGRATE, input, "r1")).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(setPermissionMode).toHaveBeenCalledWith("default");
    expect(s.spec.permissionMode).toBe("auto");
    await post(s, "PostToolUse", "r1");
    await vi.waitFor(() => expect(setPermissionMode).toHaveBeenLastCalledWith("auto"));
    expect(s.retryWindow).toBeUndefined();
  });

  it("holds every other call, a subagent's too, until the CLI is back in auto mode", async () => {
    const { s, setPermissionMode } = live();
    await pre(s, MIGRATE, input, "r1");
    let decided = false;
    const other = pre(s, "Bash", { command: "ls /tmp/weft-x" }, "o1").then((r) => ((decided = true), r));
    await Promise.resolve();
    expect(decided).toBe(false);
    await post(s, "PostToolUseFailure", "r1");
    expect(await other).toEqual({});
    expect(setPermissionMode).toHaveBeenLastCalledWith("auto");
  });

  it("lets a call through at once when no retry is open", async () => {
    const { s } = live();
    expect(await pre(s, "Bash", { command: "ls" }, "o1")).toEqual({});
    expect(s.retryGrants).toEqual([callKey(MIGRATE, input)]);
  });

  it("goes back when the retry turn ends, to the mode you switched to meanwhile", async () => {
    const { s, setPermissionMode } = live();
    await pre(s, MIGRATE, input, "r1");
    s.spec.permissionMode = "acceptEdits";
    askAboutDenials("c1", s, [], "review");
    await vi.waitFor(() => expect(setPermissionMode).toHaveBeenLastCalledWith("acceptEdits"));
  });

  it("allows the granted call without a mode change in another mode, or with no live CLI", async () => {
    const { s, setPermissionMode } = live("default");
    expect(await pre(s, MIGRATE, input, "r1")).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(setPermissionMode).not.toHaveBeenCalled();
    const idle = session();
    idle.spec = { permissionMode: "auto" } as Session["spec"];
    idle.retryGrants = [callKey(MIGRATE, input)];
    expect(await pre(idle, MIGRATE, input, "r1")).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(idle.retryWindow).toBeUndefined();
  });

  it("leaves other events alone", async () => {
    const { s } = live();
    const hook = nth(nth(opts(s).PreToolUse ?? [], 0).hooks, 0);
    expect(await hook({ hook_event_name: "PostToolUse" } as HookInput, undefined, signal)).toEqual({});
    expect(await nth(nth(opts(s).PostToolUse ?? [], 0).hooks, 0)({ hook_event_name: "PreToolUse" } as HookInput, undefined, signal)).toEqual({});
  });
});

describe("outOfAutoAnswer", () => {
  it("allows a granted call, or the one the window is open for, and turns back any other caught in it", async () => {
    const s = session();
    expect(outOfAutoAnswer(s, "Bash", { command: "ls" }, "o1")).toBeNull();
    s.retryGrants = [callKey(MIGRATE, input)];
    expect(outOfAutoAnswer(s, MIGRATE, input, "r1")).toEqual({ behavior: "allow", updatedInput: input });
    const setPermissionMode = vi.fn(() => Promise.resolve());
    s.spec = { permissionMode: "auto" } as Session["spec"];
    s.query = { setPermissionMode } as unknown as Session["query"];
    s.retryGrants = [callKey(MIGRATE, input)];
    await withRetryGrant({ env: {} }, s).hooks?.PreToolUse?.[0]?.hooks[0]?.(
      { hook_event_name: "PreToolUse", tool_name: MIGRATE, tool_input: input, tool_use_id: "r1" } as HookInput, undefined, { signal: new AbortController().signal });
    expect(outOfAutoAnswer(s, MIGRATE, input, "r1")).toEqual({ behavior: "allow", updatedInput: input });
    const other = outOfAutoAnswer(s, "Bash", { command: "ls" }, "o1");
    expect(other?.behavior).toBe("deny");
    expect(other && "message" in other ? other.message : "").toMatch(/Run it again/);
    askAboutDenials("c1", s, [], "review");
  });
});

describe("retryMessage", () => {
  it("names the calls", () => {
    expect(retryMessage([MIGRATE])).toMatch(/the supabase apply_migration call .* exactly that call .* lets it through/);
    expect(retryMessage(["Bash", "Bash", "Edit"])).toMatch(/the Bash, Edit calls .* lets them through/);
  });
});

describe("takeGrant", () => {
  it("lets the matching call through once", () => {
    const s = session();
    s.retryGrants = [callKey(MIGRATE, input)];
    expect(takeGrant(s, MIGRATE, { name: "other" })).toBe(false);
    expect(takeGrant(s, MIGRATE, { query: input.query, name: input.name })).toBe(true);
    expect(takeGrant(s, MIGRATE, input)).toBe(false);
    expect(takeGrant(session(), MIGRATE, input)).toBe(false);
  });
});

describe("dropDenialPrompts", () => {
  it("drops the classifier prompts a reply moved on from and marks them denied", () => {
    const s = session();
    const other = { id: "o", index: 1, why: { category: "mode" } };
    s.pending = [other, { id: "d", index: 2, toolName: "Bash", title: "t", why: { category: "classifier" } }] as Session["pending"];
    dropDenialPrompts("c1", s);
    expect(s.pending).toEqual([other]);
    expect(replaceThreadItem).toHaveBeenCalledWith("c1", 2, expect.objectContaining({ id: "d", decision: "deny" }));
  });
});

function nth<T>(arr: readonly T[], i: number): T {
  const item = arr.at(i);
  if (item === undefined) throw new Error(`No item at ${String(i)}`);
  return item;
}

describe("withRetryGrant", () => {
  const hookCall = (s: Session, ev: Partial<HookInput>) => {
    const opts = withRetryGrant({ env: {}, hooks: { PreToolUse: [{ hooks: [] }], PostToolUse: [{ hooks: [] }], PostToolUseFailure: [{ hooks: [] }] } }, s);
    expect(opts.hooks?.PostToolUse).toHaveLength(2);
    expect(opts.hooks?.PostToolUseFailure).toHaveLength(2);
    const matchers = opts.hooks?.PreToolUse ?? [];
    expect(matchers).toHaveLength(2);
    return nth(nth(matchers, 1).hooks, 0)(ev as HookInput, undefined, { signal: new AbortController().signal });
  };

  it("allows a granted call, once", async () => {
    const s = session();
    s.retryGrants = [callKey(MIGRATE, input)];
    const ev = { hook_event_name: "PreToolUse", tool_name: MIGRATE, tool_input: input, tool_use_id: "r1" } as const;
    expect(await hookCall(s, ev)).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(await hookCall(s, ev)).toEqual({});
  });

  it("works with no hooks to add to", () => {
    expect(withRetryGrant({ env: {} }, session()).hooks?.PreToolUse).toHaveLength(1);
  });
});
