// The table every host mounts: runVerb runs each verb in it and refuses any other name, each handler's
// `elevated` matches the guard its local route uses, and the body pickers and the 404 mapping routes share.
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const db = vi.hoisted(() => ({ cards: new Map<string, Card>() }));

vi.mock("@/lib/store", () => ({
  getCard: vi.fn((id: string) => db.cards.get(id)),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => Object.assign(db.cards.get(id)!, patch)),
  reorderCard: vi.fn(),
}));
vi.mock("@/lib/runner", () => ({
  stop: vi.fn(() => Promise.resolve()),
  sendMessage: vi.fn(),
  sendUserMessage: vi.fn(),
  editLastMessage: vi.fn(() => Promise.resolve()),
  queueMessages: vi.fn(),
  archiveWhenIdle: vi.fn(),
  endSession: vi.fn(() => Promise.resolve()),
  isBusy: vi.fn(() => false),
  setPermissionMode: vi.fn(),
  answerPermission: vi.fn(),
  waitPermission: vi.fn(),
  switchBackend: vi.fn(() => Promise.resolve()),
  rerunOnModel: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/automations", () => ({ firstMessage: vi.fn(), messagesForMove: vi.fn(() => []), doneOverrides: vi.fn(() => ({})) }));
vi.mock("@/lib/agent-store", () => ({ listAgents: vi.fn(() => []) }));
vi.mock("@/lib/card-repoint", () => ({ repointCard: vi.fn() }));
vi.mock("@/lib/folders", () => ({ resolveFolder: vi.fn() }));
vi.mock("@/lib/tag-store", () => ({ rememberTags: vi.fn() }));
vi.mock("@/lib/task-stop", () => ({ stopTask: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/shell", () => ({ runShell: vi.fn() }));
vi.mock("@/lib/splice", () => ({ sendFresh: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/copilot", () => ({ sendToCopilot: vi.fn() }));
vi.mock("@/lib/restart", () => ({ restartTurn: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/precedence", () => ({ putFirst: vi.fn(), putHolderFirst: vi.fn() }));

const runner = await import("@/lib/runner");
const api = await import("./index");
const { HOST_API, runVerb, needsElevation, isHostVerb, hostFail, NotFound, requireCard, messageCall, permissionCall } = api;
type HostVerb = keyof typeof HOST_API;

beforeEach(() => {
  db.cards.clear();
  db.cards.set("c1", { id: "c1", title: "t", column: "review", cwd: "/repo" } as Card);
  vi.clearAllMocks();
});

// One sample call per verb, with the reply it gives.
const card = () => ({ card: db.cards.get("c1") });
const SAMPLES: Record<HostVerb, { args: unknown; reply: () => unknown }> = {
  "card.update": { args: { id: "c1", body: { title: "New" } }, reply: card },
  "card.stop": { args: { id: "c1" }, reply: () => ({ ok: true }) },
  "card.shell": { args: { id: "c1", command: "ls" }, reply: () => ({ ok: true }) },
  "card.fresh": { args: { id: "c1", message: "hi" }, reply: () => ({ ok: true }) },
  "card.message": { args: { id: "c1", text: "hi" }, reply: card },
  "card.message.edit": { args: { id: "c1", text: "hi" }, reply: card },
  "card.restart": { args: { id: "c1" }, reply: card },
  "card.permission.answer": { args: { id: "c1", allow: true }, reply: () => ({ ok: true }) },
  "card.permission.wait": { args: { id: "c1", pendingId: "p" }, reply: () => ({ ok: true }) },
  "card.permission.first": { args: { id: "c1", pendingId: "p" }, reply: () => ({ ok: true }) },
  "card.permission.otherFirst": { args: { id: "c1", pendingId: "p" }, reply: () => ({ ok: true }) },
  "card.switchBackend": { args: { id: "c1", backend: "claude" }, reply: card },
  "card.rerunModel": { args: { id: "c1", model: "claude-opus-5-5" }, reply: card },
  "card.stopTask": { args: { id: "c1", taskId: "t1" }, reply: () => ({ ok: true }) },
};

// The local route each verb is mounted on.
const ROUTES: Record<HostVerb, string> = {
  "card.update": "route.ts",
  "card.stop": "stop/route.ts",
  "card.shell": "shell/route.ts",
  "card.fresh": "fresh/route.ts",
  "card.message": "messages/route.ts",
  "card.message.edit": "messages/route.ts",
  "card.restart": "messages/route.ts",
  "card.permission.answer": "permission/route.ts",
  "card.permission.wait": "permission/route.ts",
  "card.permission.first": "permission/route.ts",
  "card.permission.otherFirst": "permission/route.ts",
  "card.switchBackend": "switch-backend/route.ts",
  "card.rerunModel": "rerun-model/route.ts",
  "card.stopTask": "tasks/[taskId]/stop/route.ts",
};

const verbs = Object.keys(HOST_API) as HostVerb[];

describe("HOST_API", () => {
  it.each(verbs)("runs %s", async (verb) => {
    const reply = await runVerb(verb, SAMPLES[verb].args as never);
    expect(reply).toEqual(SAMPLES[verb].reply());
  });

  it("names the same verbs as the samples and the routes", () => {
    expect(verbs.sort()).toEqual(Object.keys(SAMPLES).sort());
    expect(verbs.sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(verbs)("%s is elevated exactly when its route checks elevated() first", (verb) => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/cards/[id]", ROUTES[verb]), "utf8");
    const first = /const denied = (guard|elevated)\(req\)/.exec(source)?.[1];
    expect(first).toBeDefined();
    expect(HOST_API[verb].elevated).toBe(first === "elevated");
  });

  it("refuses a verb that isn't in the table", async () => {
    expect(isHostVerb("card.delete")).toBe(false);
    expect(isHostVerb("toString")).toBe(false);
    expect(isHostVerb("card.stop")).toBe(true);
    await expect(runVerb("card.delete" as HostVerb, { id: "c1" })).rejects.toThrow("Unknown host verb: card.delete");
    expect(runner.stop).not.toHaveBeenCalled();
  });

  it("needs elevation for a power verb, and for a card update only when it widens", () => {
    expect(needsElevation("card.shell", { id: "c1" })).toBe(true);
    expect(needsElevation("card.stop", { id: "c1" })).toBe(false);
    expect(needsElevation("card.update", { id: "c1", body: { title: "x" } })).toBe(false);
    expect(needsElevation("card.update", { id: "c1", body: { permissionMode: "auto" } })).toBe(true);
    expect(needsElevation("card.update", { id: "c1", body: { readScope: "/x" } })).toBe(true);
  });
});

describe("the route side", () => {
  it("maps NotFound to 404 and any other error to the route's status", async () => {
    expect(() => requireCard("nope")).toThrow(NotFound);
    expect(requireCard("c1")).toBe(db.cards.get("c1"));
    const missing = hostFail(new NotFound("No such card."), 409);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "No such card." });
    expect(hostFail(new Error("x")).status).toBe(400);
    expect(hostFail(new Error("x"), 409).status).toBe(409);
  });

  it("picks the messages verb: restart, then edit, then a send", () => {
    expect(messageCall("c1", { restart: true, text: "x" })).toEqual({ verb: "card.restart", args: { id: "c1" } });
    expect(messageCall("c1", { edit: true, text: "x" })).toEqual({ verb: "card.message.edit", args: { id: "c1", text: "x" } });
    expect(messageCall("c1", { text: "x" })).toEqual({ verb: "card.message", args: { id: "c1", text: "x" } });
  });

  it("picks the permission verb: first, then others first, then wait, else an answer", () => {
    const all = { first: true, otherFirst: true, wait: true, pendingId: "p" };
    expect(permissionCall("c1", all)).toEqual({ verb: "card.permission.first", args: { id: "c1", pendingId: "p" } });
    expect(permissionCall("c1", { ...all, first: false })).toEqual({ verb: "card.permission.otherFirst", args: { id: "c1", pendingId: "p" } });
    expect(permissionCall("c1", { wait: true, pendingId: "p" })).toEqual({ verb: "card.permission.wait", args: { id: "c1", pendingId: "p" } });
    expect(permissionCall("c1", { allow: true, answers: { q: "a" }, pendingId: "p", annotations: {}, chat: "c" })).toEqual({
      verb: "card.permission.answer",
      args: { id: "c1", allow: true, answers: { q: "a" }, pendingId: "p", annotations: {}, chat: "c" },
    });
  });
});
