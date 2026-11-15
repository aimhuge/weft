import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "./runner-state";

// A call you allowed once after auto mode blocked it, retried on a CLI other than the one you answered on
// (lib/classifier-denial.ts carryGrants; lib/runner.ts sessionFor moves the grants).

const sendMessage = vi.fn();
vi.mock("./store", () => ({ appendThread: () => 7, replaceThreadItem: vi.fn() }));
vi.mock("./runner-state", () => ({ safeUpdate: vi.fn(), hooks: { send: sendMessage } }));
vi.mock("./runner-pending", () => ({ pendingView: (p: { id: string; title: string }) => ({ id: p.id, title: p.title }) }));

const { askAboutDenials, callKey, carryGrants, noteDenial, retryMessage, withRetryGrant } = await import("./classifier-denial");

const MIGRATE = "mcp__supabase__apply_migration";
const input = { name: "add_x", query: "create table x ()" };

function session(): Session {
  return { pending: [], spec: { permissionMode: "default" } } as unknown as Session;
}

function denied(over: Record<string, unknown>) {
  return { type: "system", subtype: "permission_denied", decision_reason_type: "classifier", message: "Permission denied", uuid: "u", session_id: "s", ...over } as unknown as Parameters<typeof noteDenial>[1];
}

function hookCall(s: Session, ev: Partial<HookInput>) {
  const hook = withRetryGrant({ env: {} }, s).hooks?.PreToolUse?.[0]?.hooks[0];
  if (!hook) throw new Error("no PreToolUse hook");
  return hook(ev as HookInput, undefined, { signal: new AbortController().signal });
}

beforeEach(() => vi.clearAllMocks());

describe("carryGrants", () => {
  it("moves the unspent grants onto the session that runs the retry, after any it already has", () => {
    const from = session();
    const to = session();
    from.retryGrants = [callKey(MIGRATE, input)];
    to.retryGrants = ["Bash\n{}"];
    carryGrants(from, to);
    expect(to.retryGrants).toEqual(["Bash\n{}", callKey(MIGRATE, input)]);
    expect(from.retryGrants).toBeUndefined();
  });

  it("leaves things alone with no earlier session, the same one, or nothing granted", () => {
    const s = session();
    s.retryGrants = ["x"];
    carryGrants(undefined, s);
    carryGrants(s, s);
    expect(s.retryGrants).toEqual(["x"]);
    const empty = session();
    carryGrants(empty, s);
    expect(s.retryGrants).toEqual(["x"]);
  });
});

describe("a retry on another CLI", () => {
// The reported bug: two Writes skipped by the classifier ("gave no verdict"), both allowed once, and the retry
// turn ran on a new CLI (the old one was from an older build), whose hook had no grant and let auto mode deny again.
  it("lets an allowed no-verdict Write through on the CLI that runs the retry, once each", async () => {
    const answeredOn = session();
    const css = { file_path: "/p/kit/research.css", content: "body {}" };
    const js = { file_path: "/p/kit/research.js", content: "export {}" };
    const skipped = (id: string) => denied({ tool_name: "Write", tool_use_id: id, decision_reason: "The server-side auto mode classifier gave no verdict (it skipped this action)" });
    noteDenial(answeredOn, skipped("w1"));
    noteDenial(answeredOn, skipped("w2"));
    const denials = [{ tool_name: "Write", tool_use_id: "w1", tool_input: css }, { tool_name: "Write", tool_use_id: "w2", tool_input: js }];
    expect(askAboutDenials("c1", answeredOn, denials, "review")).toBe(true);
    for (const p of [...answeredOn.pending]) {
      answeredOn.pending.splice(answeredOn.pending.indexOf(p), 1);
      p.resolve({ behavior: "allow", updatedInput: p.input });
    }
    expect(sendMessage).toHaveBeenCalledWith("c1", retryMessage(["Write", "Write"]));
    const retriesOn = session();
    carryGrants(answeredOn, retriesOn);
    const ev = (tool_input: object, id: string) => ({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { ...tool_input }, tool_use_id: id }) as const;
    expect(await hookCall(retriesOn, ev(css, "r1"))).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(await hookCall(retriesOn, ev(js, "r2"))).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(await hookCall(retriesOn, ev(css, "r3"))).toEqual({});
  });

});
