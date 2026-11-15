import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "./runner-state";
import type { Card } from "./types";

// Ask once per card for a skill's folder or a settings file: the reported case was a card building
// plugin/skills/research, whose every Write the classifier skipped, asked about four times over two hours.

const cards = new Map<string, Partial<Card>>();
const sendMessage = vi.fn();
vi.mock("./store", () => ({ appendThread: () => 7, replaceThreadItem: vi.fn(), getCard: (id: string) => cards.get(id) }));
vi.mock("./runner-state", () => ({
  safeUpdate: (id: string, patch: Partial<Card>) => cards.has(id) && Object.assign(cards.get(id) ?? {}, patch),
  hooks: { send: sendMessage },
}));
vi.mock("./runner-pending", () => ({ pendingView: (p: { id: string; title: string }) => ({ id: p.id, title: p.title }) }));

const { askAboutDenials, noteDenial, outOfAutoAnswer, retryMessage, withRetryGrant } = await import("./classifier-denial");
const { grantButton, grantScope, grantWrites, writeGranted } = await import("./write-grant");

const CWD = "/Users/me/dev/weft";
const SKILL = `${CWD}/plugin/skills/research`;

function session(cardId: string | null = "c1"): Session {
  return { cardId, pending: [], spec: { permissionMode: "default", cwd: CWD } } as unknown as Session;
}

function skipped(s: Session, id: string, tool = "Write") {
  noteDenial(s, { type: "system", subtype: "permission_denied", decision_reason_type: "classifier", decision_reason: "gave no verdict (it skipped this action)", tool_name: tool, tool_use_id: id, uuid: "u", session_id: "s" } as unknown as Parameters<typeof noteDenial>[1]);
}

function hookCall(s: Session, tool_name: string, tool_input: object, tool_use_id: string) {
  const hook = withRetryGrant({ env: {} }, s).hooks?.PreToolUse?.[0]?.hooks[0];
  if (!hook) throw new Error("no PreToolUse hook");
  return hook({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id } as unknown as HookInput, undefined, { signal: new AbortController().signal });
}

function answerAll(s: Session, allow: boolean) {
  for (const p of [...s.pending]) {
    s.pending.splice(s.pending.indexOf(p), 1);
    p.resolve(allow ? { behavior: "allow", updatedInput: p.input } : { behavior: "deny", message: "no" });
  }
}

const allowed = { hookSpecificOutput: { permissionDecision: "allow" } };

beforeEach(() => {
  vi.clearAllMocks();
  cards.clear();
  cards.set("c1", {});
  cards.set("c2", {});
});

describe("a blocked write into a skill's folder", () => {
  it("asks once for the folder, says so on the button, and lets the card's later writes there through", async () => {
    const s = session();
    const css = { file_path: `${SKILL}/kit/research.css`, content: "body {}" };
    const js = { file_path: `${SKILL}/kit/research.js`, content: "export {}" };
    skipped(s, "w1");
    skipped(s, "w2");
    askAboutDenials("c1", s, [{ tool_name: "Write", tool_use_id: "w1", tool_input: css }, { tool_name: "Write", tool_use_id: "w2", tool_input: js }], "review");
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]?.title).toBe("Auto mode blocked 2 writes to the research skill");
    expect(s.pending[0]?.why?.grant).toBe("Allow writes to the research skill for this card");
    answerAll(s, true);
    expect(cards.get("c1")?.writeScope).toEqual([SKILL]);
    expect(sendMessage).toHaveBeenCalledWith("c1", retryMessage(["Write", "Write"], ["the research skill"]));
    // The retries, then a new file in the same skill, later in the card's life.
    expect(await hookCall(s, "Write", css, "r1")).toMatchObject(allowed);
    expect(await hookCall(s, "Write", js, "r2")).toMatchObject(allowed);
    expect(await hookCall(s, "Write", { file_path: `${SKILL}/playbooks/marketing-teardown.md`, content: "#" }, "r3")).toMatchObject(allowed);
    expect(await hookCall(s, "Edit", { file_path: `${SKILL}/kit/research.js`, old_string: "export {}", new_string: "export const x = 1" }, "r4")).toMatchObject(allowed);
  });

  it("never covers another folder, another tool, or another card", async () => {
    cards.set("c1", { writeScope: [SKILL] });
    expect(await hookCall(session(), "Write", { file_path: `${CWD}/plugin/skills/other/SKILL.md`, content: "x" }, "a")).toEqual({});
    expect(await hookCall(session(), "Write", { file_path: `${CWD}/lib/runner.ts`, content: "x" }, "b")).toEqual({});
    expect(await hookCall(session(), "Bash", { command: `rm -rf ${SKILL}` }, "c")).toEqual({});
    expect(await hookCall(session("c2"), "Write", { file_path: `${SKILL}/kit/a.css`, content: "x" }, "d")).toEqual({});
    expect(await hookCall(session(null), "Write", { file_path: `${SKILL}/kit/a.css`, content: "x" }, "e")).toEqual({});
  });

  it("keeps a plain one-time allow for writes outside a skill folder, and for Keep denied grants nothing", () => {
    const s = session();
    const file = { file_path: `${CWD}/lib/x.ts`, content: "x" };
    skipped(s, "w1");
    askAboutDenials("c1", s, [{ tool_name: "Write", tool_use_id: "w1", tool_input: file }], "review");
    expect(s.pending[0]?.why?.grant).toBeUndefined();
    answerAll(s, true);
    expect(cards.get("c1")?.writeScope).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith("c1", retryMessage(["Write"]));
    const t = session();
    skipped(t, "w2");
    askAboutDenials("c1", t, [{ tool_name: "Write", tool_use_id: "w2", tool_input: { file_path: `${SKILL}/a.md`, content: "x" } }], "review");
    answerAll(t, false);
    expect(cards.get("c1")?.writeScope).toBeUndefined();
  });

  it("answers canUseTool for a granted write, so default mode doesn't ask either", () => {
    cards.set("c1", { writeScope: [SKILL] });
    const input = { file_path: `${SKILL}/a.md`, content: "x" };
    expect(outOfAutoAnswer(session(), "Write", input, "x")).toEqual({ behavior: "allow", updatedInput: input });
    expect(outOfAutoAnswer(session(), "Write", { file_path: `${CWD}/a.md`, content: "x" }, "x")).toBeNull();
  });
});

describe("settings files", () => {
  const settings = `${CWD}/.claude/settings.local.json`;

  it("grants a settings file for changes that leave permissions alone", () => {
    const s = session();
    expect(grantScope(s, "Write", { file_path: settings, content: '{"model":"opus"}' })).toEqual({ path: settings, kind: "settings", name: "settings.local.json" });
    expect(grantButton({ path: settings, kind: "settings", name: "settings.local.json" })).toBe("Allow writes to settings.local.json for this card");
  });

  it("asks every time for a write that changes permissions, granted or not", async () => {
    const perms = { file_path: settings, content: '{"permissions":{"allow":["Bash"]}}' };
    expect(grantScope(session(), "Write", perms)).toBeUndefined();
    cards.set("c1", { writeScope: [settings] });
    expect(writeGranted(session(), "Write", perms)).toBe(false);
    expect(await hookCall(session(), "Write", perms, "p")).toEqual({});
    expect(writeGranted(session(), "Write", { file_path: settings, content: '{"model":"opus"}' })).toBe(true);
  });
});

describe("grantWrites", () => {
  it("adds a scope once, and does nothing for a card that's gone", () => {
    const scope = { path: SKILL, kind: "skill" as const, name: "research" };
    grantWrites("c1", scope);
    grantWrites("c1", scope);
    expect(cards.get("c1")?.writeScope).toEqual([SKILL]);
    grantWrites("gone", scope);
    expect(cards.has("gone")).toBe(false);
  });

  it("grants nothing without a working folder", () => {
    const s = { cardId: "c1", pending: [], spec: {} } as unknown as Session;
    expect(grantScope(s, "Write", { file_path: `${SKILL}/a`, content: "x" })).toBeUndefined();
    expect(writeGranted(s, "Write", { file_path: `${SKILL}/a`, content: "x" })).toBe(false);
  });
});
