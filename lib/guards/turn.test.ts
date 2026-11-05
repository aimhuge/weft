import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessions, type Session } from "../runner-state";
import { addCards, deleteCard } from "../store";
import type { Card } from "../types";
import { decide, type GuardCall } from "./decide";
import { GUARD_TOKEN_ENV, GUARD_URL_ENV, guardTurn, GuardsUnavailable, openGuards } from "./turn";

// One turn's guards: the token, the address and the env that carry them, and the guard set the turn's own hook
// runs its calls through. A turn that can't be opened is a turn that doesn't run at all.

const PORT = "1033";
const cwd = process.cwd();

const card: Card = {
  id: "guard-turn-card",
  title: "Turn",
  prompt: "",
  cwd,
  backend: "codex",
  permissionMode: "bypassPermissions",
  column: "running",
  createdAt: 1,
  updatedAt: 1,
};
const session = { cardId: card.id, spec: { cwd, permissionMode: "bypassPermissions", backend: "codex" }, pending: [], abort: new AbortController(), busy: true, retryGrants: [] } as unknown as Session;
const other = { cardId: "guard-turn-other", busy: true } as unknown as Session;
const idle = { cardId: "guard-turn-idle", busy: false } as unknown as Session;

beforeAll(() => {
  vi.stubEnv("PORT", PORT);
  addCards([card]);
  sessions.set(card.id, session);
  sessions.set(other.cardId as string, other);
  sessions.set(idle.cardId as string, idle);
});

afterAll(() => {
  sessions.delete(card.id);
  sessions.delete(other.cardId as string);
  sessions.delete(idle.cardId as string);
  deleteCard(card.id);
  vi.unstubAllEnvs();
});

const signal = () => new AbortController().signal;

describe("openGuards", () => {
  it("refuses to open without a port to answer on", () => {
    expect(() => openGuards(session, "codex", "")).toThrow(GuardsUnavailable);
    expect(() => openGuards(session, "codex", "")).toThrow(/server port isn't known/);
  });

  it("refuses to open for a thread with no card, since nothing could answer its hook", () => {
    const spare = { cardId: null, spec: { cwd }, pending: [], abort: new AbortController(), busy: false } as unknown as Session;
    expect(() => openGuards(spare, "codex", PORT)).toThrow(GuardsUnavailable);
    expect(() => openGuards(spare, "codex", PORT)).toThrow(/no card yet/);
  });

  it("gives the turn a token, the route's address and the env that carries them", () => {
    const guards = openGuards(session, "codex", PORT);
    expect(guards.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(guards.url).toBe(`http://127.0.0.1:${PORT}/api/guards`);
    expect(guards.env).toEqual({ [GUARD_TOKEN_ENV]: guards.token, [GUARD_URL_ENV]: guards.url });
    guards.close();
  });

  it("reads the port from the environment when it isn't given one", () => {
    const guards = openGuards(session, "codex");
    expect(guards.url).toBe(`http://127.0.0.1:${PORT}/api/guards`);
    guards.close();
  });

  it("opens the turn's guard set, so its hook can run a call through it", () => {
    const guards = openGuards(session, "codex", PORT);
    const turn = guardTurn(guards.token, "codex");
    expect(turn?.session).toBe(session);
    expect(turn?.hooks.PreToolUse?.length).toBeGreaterThan(0);
    guards.close();
  });
});

describe("guardTurn", () => {
  it("finds the open turn a token stands for", () => {
    const guards = openGuards(session, "codex", PORT);
    expect(guardTurn(guards.token, "codex")?.cli).toBe("codex");
    guards.close();
  });

  it("finds nothing for another CLI's turn", () => {
    const guards = openGuards(session, "codex", PORT);
    expect(guardTurn(guards.token, "goose")).toBeUndefined();
    guards.close();
  });

  it("finds nothing without a token", () => {
    expect(guardTurn(undefined, "codex")).toBeUndefined();
    expect(guardTurn("", "codex")).toBeUndefined();
  });

  it("finds nothing once the turn is closed", () => {
    const guards = openGuards(session, "codex", PORT);
    guards.close();
    expect(guardTurn(guards.token, "codex")).toBeUndefined();
  });
});

describe("the turns a card's guard set counts", () => {
  const killing = (id: string): GuardCall => ({ event: "PreToolUse", tool: "Bash", input: { command: `lsof -ti :${PORT} | xargs kill` }, cwd, id });

  it("turns a call that would kill Weft away while another turn runs", async () => {
    const guards = openGuards(session, "codex", PORT);
    const turn = guardTurn(guards.token, "codex");
    const verdict = await decide(turn!.hooks, killing("guard-turn-busy"), signal());
    expect(verdict.decision).toBe("deny");
    expect(verdict.decision === "deny" && verdict.reason).toContain("restart_weft_when_idle");
    guards.close();
  });

  it("asks for no card when the turn's card is gone by the time a guard runs", async () => {
    const guards = openGuards(session, "codex", PORT);
    const turn = guardTurn(guards.token, "codex");
    // The card is detached after the turn opened: the guard set's card getter has nothing to say.
    const was = session.cardId;
    session.cardId = null;
    const verdict = await decide(turn!.hooks, { event: "PreToolUse", tool: "Bash", input: { command: "ls" }, cwd, id: "guard-turn-nocard" }, signal());
    expect(verdict.decision).toBe("allow");
    session.cardId = was;
    guards.close();
  });

  it("counts the busy sessions other than this one, and no idle ones", async () => {
    // This session is busy, the other one is busy and the third is idle: the other busy one is the only
    // turn counted, so the call that would kill Weft is still turned away.
    const guards = openGuards(session, "codex", PORT);
    const turn = guardTurn(guards.token, "codex");
    const busy = await decide(turn!.hooks, killing("guard-turn-count"), signal());
    expect(busy.decision).toBe("deny");
    guards.close();

    // With the other busy session gone, nothing else is running, so the call is allowed.
    sessions.delete(other.cardId as string);
    const alone = openGuards(session, "codex", PORT);
    const turnAlone = guardTurn(alone.token, "codex");
    const verdict = await decide(turnAlone!.hooks, killing("guard-turn-alone"), signal());
    expect(verdict.decision).toBe("allow");
    alone.close();
    sessions.set(other.cardId as string, other);
  });
});
