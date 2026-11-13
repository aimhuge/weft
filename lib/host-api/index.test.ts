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
  deleteCard: vi.fn((id: string) => db.cards.delete(id)),
  listCards: vi.fn(() => [...db.cards.values()]),
  getThread: vi.fn(() => [{ kind: "tool", id: "t1", name: "Bash", input: {}, result: "out", at: 1 }]),
}));
vi.mock("@/lib/settings", () => ({ dismissSession: vi.fn(), listProjects: vi.fn(() => []) }));
vi.mock("@/lib/repos", () => ({ projectRoot: vi.fn((cwd: string) => cwd) }));
vi.mock("@/lib/import", () => ({ loadTranscript: vi.fn(() => Promise.resolve()) }));
vi.mock("./card-ids", () => ({ cardIds: () => ({ used: () => false, remember: () => undefined }) }));
vi.mock("@/lib/worktree-pool", () => ({ dropWorktree: vi.fn(() => Promise.resolve()) }));
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
  warmUp: vi.fn(),
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
vi.mock("@/lib/scheduler", () => ({
  scheduleMessage: vi.fn((id: string) => db.cards.get(id)),
  unscheduleMessage: vi.fn((id: string) => db.cards.get(id)),
}));
vi.mock("@/lib/host-settings", () => ({
  hostSettings: vi.fn(() => ({ maxThreads: 6, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude" })),
  applyHostSettings: vi.fn(() => ({ maxThreads: 6, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude" })),
}));
vi.mock("@/lib/new-card", () => ({
  createCardFromBody: vi.fn((_body: unknown, id: string) => ({ id, title: "t" })),
  startCard: vi.fn(() => ({ started: true })),
}));
vi.mock("@/lib/crons", () => ({
  updateCron: vi.fn((id: string, patch: object) => ({ id, ...patch })),
  deleteCron: vi.fn(),
  createCron: vi.fn((input: object) => ({ id: "k2", ...input })),
}));
vi.mock("@/lib/cron-run", () => ({ runCron: vi.fn(() => Promise.resolve({ id: "run-1" })) }));
vi.mock("@/lib/webhooks", () => ({ updateWebhook: vi.fn((id: string, patch: object) => ({ id, ...patch })), removeWebhook: vi.fn(() => ({ id: "h1" })) }));
vi.mock("@/lib/skills", () => ({ listSkills: vi.fn(() => [{ name: "ship", description: "d", source: "project" }]) }));
vi.mock("@/lib/file-access", () => ({
  listFiles: vi.fn(() => Promise.resolve(["a.ts"])),
  readFile: vi.fn(() => Promise.resolve({ path: "a.ts", exists: true, text: "x", hash: "h", mtime: 1, size: 1 })),
  headOf: vi.fn(() => Promise.resolve({ path: "a.ts", text: null })),
  safePath: vi.fn(() => Promise.resolve({ abs: "/repo/a.ts", rel: "a.ts" })),
  writeFile: vi.fn(() => Promise.resolve({ result: { hash: "h2", mtime: 2 } })),
}));
vi.mock("@/lib/devserver", () => ({
  LOG_LIMIT: 200_000,
  stopDev: vi.fn(),
  restartDev: vi.fn(() => Promise.resolve()),
  runs: new Map([["c1", { log: "ready\n" }]]),
  devStatus: vi.fn(() => Promise.resolve({ state: "stopped" })),
  reachable: vi.fn(() => Promise.resolve(false)),
  startDev: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@/lib/devserver-list", () => ({ listDev: vi.fn(() => Promise.resolve([{ cardId: "c1", url: "http://localhost:3000/" }])) }));
vi.mock("./tree-snapshot", () => ({ treeSnapshotVerb: vi.fn(() => Promise.resolve({ sha: "s1", mac: "m1mini", branch: "main", running: 0 })) }));
vi.mock("@/lib/tunnels", () => ({ openTunnel: vi.fn(() => Promise.resolve({ address: "https://weft.zip/t/t1" })) }));

const runner = await import("@/lib/runner");
const api = await import("./index");
const { HOST_API, runVerb, needsElevation, isHostVerb, hostFail, NotFound, requireCard, messageCall, permissionCall } = api;
type HostVerb = keyof typeof HOST_API;

beforeEach(() => {
  db.cards.clear();
  db.cards.set("c1", { id: "c1", title: "t", column: "review", cwd: "/repo", review: { dev: "pnpm dev" } } as Card);
  vi.clearAllMocks();
});

// One sample call per verb, with the reply it gives.
const card = () => ({ card: db.cards.get("c1") });
const SAMPLES: Record<HostVerb, { args: unknown; reply: () => unknown }> = {
  "card.create": { args: { id: "new-card-1", prompt: "hi" }, reply: () => ({ card: { id: "new-card-1", title: "t" }, start: { started: true } }) },
  "card.update": { args: { id: "c1", body: { title: "New" } }, reply: card },
  "card.stop": { args: { id: "c1" }, reply: () => ({ ok: true }) },
  "card.warm": { args: { id: "c1" }, reply: () => ({ ok: true }) },
  "card.delete": { args: { id: "c1" }, reply: () => ({ ok: true }) },
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
  "card.schedule": { args: { id: "c1", text: " later ", at: 9e12 }, reply: card },
  "card.unschedule": { args: { id: "c1", messageId: "m1" }, reply: card },
  "skills.list": { args: { id: "c1" }, reply: () => ({ skills: [{ name: "ship", description: "d", source: "project" }] }) },
  "files.list": { args: { id: "c1" }, reply: () => ({ files: ["a.ts"] }) },
  "files.read": { args: { id: "c1", path: "a.ts" }, reply: () => ({ file: { path: "a.ts", exists: true, text: "x", hash: "h", mtime: 1, size: 1 } }) },
  "files.write": { args: { id: "c1", path: "a.ts", text: "y", baseHash: "h" }, reply: () => ({ result: { hash: "h2", mtime: 2 } }) },
  "files.watch": { args: { id: "c1", path: "a.ts" }, reply: () => ({ path: "a.ts", hash: "h" }) },
  "files.unwatch": { args: { id: "c1", path: "a.ts" }, reply: () => ({ path: "a.ts" }) },
  "dev.open": { args: { id: "c1" }, reply: () => ({ address: "https://weft.zip/t/t1" }) },
  "dev.stop": { args: { id: "c1" }, reply: () => ({ ok: true }) },
  "cron.create": { args: { id: "c1", prompt: "p", expr: "0 9 * * *" }, reply: () => ({ cron: { id: "k2", prompt: "p", expr: "0 9 * * *", cardId: "c1", by: "you" } }) },
  "cron.update": { args: { id: "k1", patch: { enabled: false } }, reply: () => ({ cron: { id: "k1", enabled: false } }) },
  "cron.delete": { args: { id: "k1" }, reply: () => ({ ok: true }) },
  "cron.run": { args: { id: "k1" }, reply: () => ({ card: { id: "run-1" } }) },
  "webhook.update": { args: { id: "h1", patch: { registered: true } }, reply: () => ({ hook: { id: "h1", registered: true } }) },
  "webhook.delete": { args: { id: "h1" }, reply: () => ({ ok: true }) },
  "dev.restart": { args: { id: "c1" }, reply: () => ({ ok: true }) },
  "dev.log": { args: { id: "c1" }, reply: () => ({ log: "ready" }) },
  "dev.start": { args: { id: "c1" }, reply: () => ({ status: { state: "stopped" } }) },
  "dev.status": { args: { id: "c1" }, reply: () => ({ status: { state: "stopped" } }) },
  "card.list": { args: undefined, reply: () => ({ cards: [db.cards.get("c1")], roots: {} }) },
  "thread.page": { args: { id: "c1" }, reply: () => ({ items: [{ kind: "tool", id: "t1", name: "Bash", input: {}, result: "out", at: 1 }], start: 0, total: 1 }) },
  "thread.search": { args: { id: "c1", q: "nothing" }, reply: () => ({ matches: [] }) },
  "thread.tool": { args: { id: "c1", toolId: "t1" }, reply: () => ({ result: "out" }) },
  "settings.get": { args: undefined, reply: () => ({ settings: { maxThreads: 6, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude" } }) },
  "tree.snapshot": { args: { folder: "weft" }, reply: () => ({ sha: "s1", mac: "m1mini", branch: "main", running: 0 }) },
  "settings.put": { args: { patch: { maxThreads: 6 } }, reply: () => ({ settings: { maxThreads: 6, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude" } }) },
};

// The local route each card verb is mounted on. The host-level verbs (settings.*, tree.snapshot) have none: this Mac's
// own settings are its settings route, a host takes them from the network only on a worker, and only a worker sends its tree.
type CardVerb = Exclude<HostVerb, "settings.get" | "settings.put" | "tree.snapshot">;
const ROUTES: Record<CardVerb, string> = {
  "card.create": "../route.ts",
  "card.update": "route.ts",
  "card.stop": "stop/route.ts",
  "card.warm": "../../warm/route.ts",
  "card.delete": "route.ts",
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
  "card.schedule": "scheduled/route.ts",
  "card.unschedule": "scheduled/route.ts",
  "skills.list": "../../skills/route.ts",
  "files.list": "files/route.ts",
  "files.read": "files/route.ts",
  "files.write": "files/route.ts",
  "files.watch": "files/route.ts",
  "files.unwatch": "files/route.ts",
  "dev.open": "dev/route.ts",
  "dev.stop": "dev/route.ts",
  "cron.create": "../../crons/route.ts",
  "cron.update": "../../crons/[id]/route.ts",
  "cron.delete": "../../crons/[id]/route.ts",
  "cron.run": "../../crons/[id]/run/route.ts",
  "webhook.update": "../../webhooks/[id]/route.ts",
  "webhook.delete": "../../webhooks/[id]/route.ts",
  "dev.restart": "dev/route.ts",
  "dev.log": "dev/route.ts",
  "dev.start": "dev/route.ts",
  "dev.status": "dev/route.ts",
  "card.list": "../route.ts",
  "thread.page": "thread/route.ts",
  "thread.search": "thread/search/route.ts",
  "thread.tool": "thread/tool/[toolId]/route.ts",
};

const verbs = Object.keys(HOST_API) as HostVerb[];
const cardVerbs = verbs.filter((v): v is CardVerb => !v.startsWith("settings.") && v !== "tree.snapshot");

describe("HOST_API", () => {
  it.each(verbs)("runs %s", async (verb) => {
    const reply = await runVerb(verb, SAMPLES[verb].args as never);
    expect(reply).toEqual(SAMPLES[verb].reply());
  });

  it("names the same verbs as the samples and the routes", () => {
    expect(verbs.sort()).toEqual(Object.keys(SAMPLES).sort());
    expect(cardVerbs.sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it("keeps a host's own settings elevated", () => {
    expect(HOST_API["settings.get"].elevated).toBe(true);
    expect(HOST_API["settings.put"].elevated).toBe(true);
    expect(HOST_API["tree.snapshot"].elevated).toBe(true);
  });

  // The files route's GET (list, read) checks guard() for a read; its PUT (a save) checks elevated().
  it.each(cardVerbs)("%s is elevated exactly when its route checks elevated() first", (verb) => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/cards/[id]", ROUTES[verb]), "utf8");
    const write = verb === "files.write" ? source.slice(source.indexOf("export async function PUT")) : source;
    // A cron's or webhook's route gates a worker's with elevated() (a cloud act) and this Mac's own with guard().
    const first = /const denied = (guard|elevated)\(req[,)]/.exec(write)?.[1] ?? /isWorkerItem\(id\) \? elevated\(req\) : (guard)\(req\)/.exec(write)?.[1];
    expect(first).toBeDefined();
    expect(HOST_API[verb].elevated).toBe(first === "elevated");
  });

  it("hands a local caller's ctx to the handler, and none otherwise", async () => {
    const { createCardFromBody } = await import("@/lib/new-card");
    const local = await runVerb("card.create", { id: "", prompt: "hi", start: false }, { local: true });
    expect(local.start).toEqual({ started: false });
    expect(createCardFromBody).toHaveBeenLastCalledWith({ prompt: "hi" });
  });

  it("refuses a verb that isn't in the table", async () => {
    expect(isHostVerb("card.explode")).toBe(false);
    expect(isHostVerb("toString")).toBe(false);
    expect(isHostVerb("card.stop")).toBe(true);
    await expect(runVerb("card.explode" as HostVerb, { id: "c1" })).rejects.toThrow("Unknown host verb: card.explode");
    expect(runner.stop).not.toHaveBeenCalled();
  });

  it("is keyed by exactly @weft/client's verb names, so a phone's verb is one every host runs", async () => {
    const { HOST_VERBS } = await import("@weft/client");
    expect(Object.keys(HOST_API).sort()).toEqual([...HOST_VERBS].sort());
    for (const verb of HOST_VERBS) expect(isHostVerb(verb)).toBe(true);
  });

  it("needs elevation for a power verb, and for a card update only when it widens", () => {
    expect(needsElevation("card.shell", { id: "c1" })).toBe(true);
    expect(needsElevation("card.stop", { id: "c1" })).toBe(false);
    expect(needsElevation("card.update", { id: "c1", body: { title: "x" } })).toBe(false);
    expect(needsElevation("card.update", { id: "c1", body: { permissionMode: "auto" } })).toBe(true);
    expect(needsElevation("card.update", { id: "c1", body: { readScope: "/x" } })).toBe(true);
    expect(needsElevation("card.update", { id: "c1", body: { safeSql: true } })).toBe(true);
    expect(needsElevation("card.update", { id: "c1", body: { safeSql: false } })).toBe(true);
    expect(needsElevation("card.create", { id: "n1" })).toBe(false);
    expect(needsElevation("card.create", { id: "n1", permissionMode: "default" })).toBe(false);
    expect(needsElevation("card.create", { id: "n1", permissionMode: "acceptEdits" })).toBe(true);
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
