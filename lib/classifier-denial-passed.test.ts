import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./runner-state";

// A classifier denial the thread got past in the same turn isn't asked about (lib/classifier-denial.ts).
const safeUpdate = vi.fn();

vi.mock("./store", () => ({ appendThread: vi.fn(() => 7), replaceThreadItem: vi.fn() }));
vi.mock("./runner-state", () => ({ safeUpdate, hooks: { send: vi.fn() } }));
vi.mock("./runner-pending", () => ({ pendingView: (p: { id: string; title: string }) => ({ id: p.id, title: p.title }) }));

const { askAboutDenials, noteDenial, noteToolResult, noteToolUse } = await import("./classifier-denial");

const MIGRATE = "mcp__supabase__apply_migration";
const input = { name: "add_x", query: "create table x ()" };

function denied() {
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
  } as Parameters<typeof noteDenial>[1];
}

function session(): Session {
  return { pending: [], spec: { permissionMode: "auto" } } as unknown as Session;
}

beforeEach(() => vi.clearAllMocks());

describe("a denial the thread got past", () => {
  const calls = [{ tool_name: MIGRATE, tool_use_id: "tu1", tool_input: input }];

  it("ignores calls made before any denial", () => {
    const s = session();
    noteToolUse(s, "a", MIGRATE);
    noteToolResult(s, "a", false);
    expect(s.sinceDenial).toBeUndefined();
    noteDenial(s, denied());
    expect(askAboutDenials("c1", s, calls, "done")).toBe(true);
  });

  it("isn't asked about once the thread asked you itself, unless the turn ended in Needs you", () => {
    const s = session();
    noteDenial(s, denied());
    noteToolUse(s, "q1", "AskUserQuestion");
    expect(askAboutDenials("c1", s, calls, "done")).toBe(false);
    expect(s.pending).toHaveLength(0);
    expect(safeUpdate).not.toHaveBeenCalled();
    const stuck = session();
    noteDenial(stuck, denied());
    noteToolUse(stuck, "q1", "AskUserQuestion");
    expect(askAboutDenials("c1", stuck, calls, "needs_you")).toBe(true);
  });

  it("isn't asked about once a later call of the same tool ran", () => {
    const s = session();
    noteDenial(s, denied());
    noteToolUse(s, "tu2", MIGRATE);
    noteToolResult(s, "tu2", false);
    expect(s.sinceDenial?.size).toBe(0);
    expect(askAboutDenials("c1", s, calls, "review")).toBe(false);
    expect(s.sinceDenial).toBeUndefined();
  });

  it("is still asked about when the later call failed, was another tool, or had no result", () => {
    const s = session();
    noteDenial(s, denied());
    noteToolUse(s, "tu2", MIGRATE);
    noteToolResult(s, "tu2", true);
    noteToolUse(s, "b1", "Bash");
    noteToolResult(s, "b1", false);
    noteToolUse(s, "tu3", MIGRATE);
    noteToolResult(s, "unknown", false);
    expect(askAboutDenials("c1", s, calls, "done")).toBe(true);
  });

  it("does nothing for a result once the denials are gone", () => {
    const s = session();
    s.sinceDenial = new Map([["tu2", MIGRATE]]);
    noteToolResult(s, "tu2", false);
    expect(s.denials).toBeUndefined();
  });
});
