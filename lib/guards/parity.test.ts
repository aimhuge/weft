import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { guardedCli } from "../env";
import { sessions, type Session } from "../runner-state";
import { addCards, deleteCard } from "../store";
import type { Card } from "../types";
import { decide, type GuardCall } from "./decide";
import { answerHook } from "./hook";
import { openGuards } from "./turn";

// The proof that every CLI runs behind the same guards: the four calls Weft must never let a thread make quietly
// (read a .env, reset --hard the shared tree, kill Weft's own server while other cards run, write outside the card's
// folder), made as Claude Code, Codex and Goose make them, through the real guard set and a real card. Claude Code's
// verdict comes from its in-process hooks (lib/env.ts guardedCli); Codex's and Goose's from Weft's guard route.

const PORT = "1000";
// The card works in this repo: the git guard only protects a shared tree, never a scratch folder under /tmp.
const cwd = process.cwd();
const outside = path.join("/Users", "zzz-guard-parity", "notes.txt");

const card: Card = {
  id: "guard-parity-card",
  title: "Parity",
  prompt: "",
  cwd,
  backend: "codex",
  permissionMode: "bypassPermissions",
  column: "running",
  createdAt: 1,
  updatedAt: 1,
};
const session = { cardId: card.id, spec: { cwd, permissionMode: "bypassPermissions", backend: "codex" }, pending: [], abort: new AbortController(), busy: true, retryGrants: [] } as unknown as Session;
const other = { cardId: "guard-parity-other", busy: true } as unknown as Session;

beforeAll(() => {
  vi.stubEnv("PORT", PORT);
  addCards([card]);
  sessions.set(card.id, session);
  sessions.set(other.cardId as string, other);
});

afterAll(() => {
  sessions.delete(card.id);
  sessions.delete(other.cardId as string);
  deleteCard(card.id);
  vi.unstubAllEnvs();
});

type Case = { name: string; claude: Omit<GuardCall, "event" | "cwd" | "id">; codex: Record<string, unknown>; goose: Record<string, unknown>; want: "deny" | "ask"; says: string };

const CASES: Case[] = [
  {
    name: "reading .env",
    claude: { tool: "Bash", input: { command: "cat .env" } },
    codex: { tool_name: "Bash", tool_input: { command: "cat .env" } },
    goose: { tool_name: "shell", tool_input: { command: "cat .env" } },
    want: "deny",
    says: "keeps secret values out",
  },
  {
    name: "git reset --hard",
    claude: { tool: "Bash", input: { command: "git reset --hard" } },
    codex: { tool_name: "Bash", tool_input: { command: "git reset --hard" } },
    goose: { tool_name: "shell", tool_input: { command: "git reset --hard" } },
    want: "deny",
    says: "reset --hard",
  },
  {
    name: "killing Weft's server",
    claude: { tool: "Bash", input: { command: `lsof -ti :${PORT} | xargs kill` } },
    codex: { tool_name: "Bash", tool_input: { command: `lsof -ti :${PORT} | xargs kill` } },
    goose: { tool_name: "shell", tool_input: { command: `lsof -ti :${PORT} | xargs kill` } },
    want: "deny",
    says: "restart_weft_when_idle",
  },
  {
    name: "writing outside the card's folder",
    claude: { tool: "Write", input: { file_path: outside, content: "x" } },
    codex: { tool_name: "apply_patch", tool_input: { command: `*** Begin Patch\n*** Add File: ${outside}\n+x\n*** End Patch` } },
    goose: { tool_name: "write", tool_input: { path: outside, content: "x" } },
    want: "ask",
    says: "Outside the project",
  },
];

let n = 0;
const signal = () => new AbortController().signal;

// What Claude Code's own hooks say about the call.
async function claude(c: Case) {
  const { hooks } = guardedCli(() => 1, () => card.id);
  return decide(hooks ?? {}, { ...c.claude, event: "PreToolUse", cwd, id: `claude-${++n}` }, signal());
}

// Codex's or Goose's hook posting the call; an ask is answered No on the card, as you would.
async function viaHook(cli: "codex" | "goose", c: Case) {
  const guards = openGuards(session, cli);
  const id = `${cli}-${++n}`;
  const payload =
    cli === "codex"
      ? { hook_event_name: "PreToolUse", cwd, tool_use_id: id, ...c.codex }
      : { event: "PreToolUse", working_dir: cwd, tool_call_id: id, ...c.goose };
  const answer = answerHook(cli, "PreToolUse", guards.token, payload, signal());
  let asked: string | undefined;
  if (c.want === "ask") {
    await vi.waitFor(() => expect(session.pending.length).toBe(1));
    const pending = session.pending.shift();
    asked = pending?.title;
    pending?.resolve({ behavior: "deny", message: "Denied in Weft." });
  }
  const out = await answer;
  guards.close();
  return { out: JSON.stringify(out), asked };
}

describe.each(CASES)("$name", (c) => {
  it(`is a ${c.want} on Claude Code`, async () => {
    const verdict = await claude(c);
    expect(verdict.decision).toBe(c.want);
    expect(JSON.stringify(verdict)).toContain(c.says);
  });

  it.each(["codex", "goose"] as const)(`is refused on %s, in the same words`, async (cli) => {
    const { out, asked } = await viaHook(cli, c);
    if (c.want === "ask") {
      expect(asked).toContain(c.says);
      expect(out).toContain("Denied in Weft.");
    } else {
      expect(out).toContain(c.says);
    }
    if (cli === "codex") expect(out).toContain('"permissionDecision":"deny"');
    else expect(out).toContain('"decision":"block"');
  });
});

describe("a call nobody can check", () => {
  it("is refused when the turn's guards are closed", async () => {
    const guards = openGuards(session, "codex");
    guards.close();
    expect(await answerHook("codex", "PreToolUse", guards.token, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }, signal())).toBeNull();
  });

  it("lets a harmless call through on both", async () => {
    for (const cli of ["codex", "goose"] as const) {
      const guards = openGuards(session, cli);
      const payload = cli === "codex" ? { hook_event_name: "PreToolUse", cwd, tool_name: "Bash", tool_input: { command: "ls" } } : { event: "PreToolUse", working_dir: cwd, tool_name: "shell", tool_input: { command: "ls" } };
      expect(await answerHook(cli, "PreToolUse", guards.token, payload, signal())).toEqual(cli === "codex" ? {} : { decision: "allow" });
      guards.close();
    }
  });
});
