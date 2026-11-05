// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openGuards } from "@/lib/guards/turn";
import { sessions, type Session } from "@/lib/runner-state";
import { addCards, deleteCard } from "@/lib/store";
import type { Card } from "@/lib/types";
import { POST } from "./guards/[cli]/[event]/route";

// /api/guards/[cli]/[event]: a Codex or Goose hook posts each tool call here with its turn's bearer token, and prints
// the answer. Any status but 200 makes the hook refuse the call.

const cwd = process.cwd();
const card: Card = { id: "guard-route-card", title: "Route", prompt: "", cwd, backend: "codex", permissionMode: "bypassPermissions", column: "running", createdAt: 1, updatedAt: 1 };
const session = { cardId: card.id, spec: { cwd, permissionMode: "bypassPermissions", backend: "codex" }, pending: [], abort: new AbortController(), busy: true, retryGrants: [] } as unknown as Session;
let token = "";

beforeAll(() => {
  addCards([card]);
  sessions.set(card.id, session);
  token = openGuards(session, "codex", "1035").token;
});

afterAll(() => {
  sessions.delete(card.id);
  deleteCard(card.id);
  vi.unstubAllEnvs();
});

function call(body: string, { cli = "codex", event = "PreToolUse", host = "127.0.0.1:1024", auth = `Bearer ${token}` } = {}) {
  const req = new Request(`http://${host}/api/guards/${cli}/${event}`, { method: "POST", headers: { host, authorization: auth }, body });
  return POST(req, { params: Promise.resolve({ cli, event }) });
}
const bash = (command: string) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: "r1", cwd });

describe("POST /api/guards/[cli]/[event]", () => {
  it("refuses a host that isn't this machine", async () => {
    expect((await call(bash("ls"), { host: "evil.example" })).status).toBe(403);
    const bare = new Request("http://127.0.0.1/api/guards/codex/PreToolUse", { method: "POST", body: bash("ls") });
    expect((await POST(bare, { params: Promise.resolve({ cli: "codex", event: "PreToolUse" }) })).status).toBe(403);
  });

  it("knows only Codex and Goose, and the events the guards answer", async () => {
    expect((await call(bash("ls"), { cli: "claude" })).status).toBe(404);
    expect((await call(bash("ls"), { event: "Stop" })).status).toBe(404);
  });

  it("refuses a payload that isn't JSON", async () => {
    expect((await call("{not json")).status).toBe(400);
  });

  it("refuses a token that names no open turn", async () => {
    expect((await call(bash("ls"), { auth: "Bearer nope" })).status).toBe(401);
    expect((await call(bash("ls"), { auth: "" })).status).toBe(401);
  });

  it("answers an open turn's call: a destructive git command is refused in Codex's words", async () => {
    const res = await call(bash("git reset --hard"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  });
});
