import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// A cron's run (lib/cron-run.ts): a new card, forked from the source thread or fresh, that opens on the
// source's page and ends with a page of its own. The crons file is real (a temp dir); the cards are fake.
// The due side (which crons run, and the clock that finds them) is in lib/cron-run-due.test.ts.

// The temp dir has to exist before ./store is imported (it reads DATA_DIR at import time).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cron-run-"));
process.env.WEFT_DATA = dir;

const g = globalThis as unknown as { __weftState?: unknown };

const busy = new Set<string>();
const sent: Array<[string, string]> = [];
const scheduled: Array<[string, string, number]> = [];
const opened: Array<[string, string]> = [];

// The fake card store: vi.hoisted so the ./store mock factory (which runs before this file's body)
// can close over it.
const { cards, created, createCard } = vi.hoisted(() => {
  const cards = new Map<string, Card>();
  const created: Card[] = [];
  const createCard = vi.fn((input: Record<string, unknown>) => {
    const c = { id: `card-${created.length + 1}`, column: "backlog", createdAt: 1, updatedAt: 1, ...input } as Card;
    created.push(c);
    cards.set(c.id, c);
    return c;
  });
  return { cards, created, createCard };
});

vi.mock("./store", async () => {
  const fs = await import("node:fs");
  return {
    DATA_DIR: fs.realpathSync(process.env.WEFT_DATA!),
    createCard,
    getCard: (id: string) => cards.get(id),
  };
});

vi.mock("./runner", () => ({
  isBusy: (id: string) => busy.has(id),
  sendMessage: (id: string, text: string) => sent.push([id, text]),
}));

vi.mock("./scheduler", () => ({
  scheduleMessage: (id: string, text: string, at: number) => scheduled.push([id, text, at]),
}));

const gate = vi.hoisted(() => vi.fn<() => { at: number } | undefined>());
vi.mock("./start-gate", () => ({ startGate: gate }));

vi.mock("./browser-tools", () => ({
  openInPane: (url: string, cardId: string) => {
    opened.push([url, cardId]);
    return Promise.resolve();
  },
}));

vi.mock("./automations", () => ({ firstMessage: (card: Card) => card.prompt }));

vi.mock("./restart-when-idle", () => ({
  restartArmed: () => false,
}));

const pane = vi.hoisted(() => vi.fn<(cardId: string) => string | undefined>());
vi.mock("./pane-page", () => ({ panePage: pane }));

vi.mock("./folders", () => ({ resolveFolder: () => "/tmp/project" }));
vi.mock("./settings", () => ({ defaultPermissionMode: () => "default" }));

const { runCron, runPagePath, runNote } = await import("./cron-run");
const { createCron } = await import("./crons");
const { getCron, saveCron } = await import("./cron-store");

const NOW = Date.UTC(2026, 0, 5, 9, 0, 0);

const card = (id: string, over: Partial<Card> = {}): Card => {
  const c: Card = {
    id,
    title: `Card ${id}`,
    prompt: "p",
    cwd: "/tmp/project",
    backend: "claude",
    permissionMode: "default",
    column: "backlog",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
  cards.set(id, c);
  return c;
};

beforeEach(() => {
  // The store reads DATA_DIR at import, so the sandbox has to be in place before the import above.
  cards.clear();
  created.length = 0;
  busy.clear();
  sent.length = 0;
  scheduled.length = 0;
  opened.length = 0;
  vi.clearAllMocks();
  createCard.mockImplementation((input: Record<string, unknown>) => {
    const c = { id: `card-${created.length + 1}`, column: "backlog", createdAt: 1, updatedAt: 1, ...input } as Card;
    created.push(c);
    cards.set(c.id, c);
    return c;
  });
  gate.mockReturnValue(undefined);
  pane.mockReturnValue(undefined);
  fs.rmSync(path.join(dir, "crons.json"), { force: true });
});

afterEach(() => {
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runPagePath", () => {
  it("is the run's page under the data dir's show folder", () => {
    const p = runPagePath({ id: "abc" }, 3);
    expect(p).toContain(path.join("show", "crons", "abc"));
    expect(p.endsWith("run-3.html")).toBe(true);
  });
});

describe("runNote", () => {
  it("says which run it is and where its page goes", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", name: "Digest" }, NOW);
    const note = runNote(cron, 2);
    expect(note).toContain("run 2");
    expect(note).toContain("Digest");
    expect(note).toContain(runPagePath(cron, 2));
  });
});

describe("runCron", () => {
  it("makes a card for the run, with the prompt and the run's note", async () => {
    const cron = createCron({ prompt: "do the thing", expr: "0 9 * * *" }, NOW);
    const card = await runCron(cron.id, NOW);
    expect(card.title).toContain(cron.name);
    expect(card.prompt).toContain("do the thing");
    expect(card.prompt).toContain(runNote(cron, 1));
    expect(card.cronId).toBe(cron.id);
    expect(card.cronRun).toBe(1);
  });

  it("sends the card's first message", async () => {
    const cron = createCron({ prompt: "do the thing", expr: "0 9 * * *" }, NOW);
    const card = await runCron(cron.id, NOW);
    expect(sent).toEqual([[card.id, card.prompt]]);
  });

  it("counts the run and keeps it on the cron", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    await runCron(cron.id, NOW);
    const after = getCron(cron.id)!;
    expect(after.count).toBe(1);
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0]?.cardId).toBe(created[0]?.id);
    expect(after.runs[0]?.n).toBe(1);
  });

  it("numbers the runs", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    await runCron(cron.id, NOW);
    const second = await runCron(cron.id, NOW + 1000);
    expect(second.cronRun).toBe(2);
    expect(getCron(cron.id)!.runs.map((r) => r.n)).toEqual([1, 2]);
  });

  it("refuses a cron that isn't there", async () => {
    await expect(runCron("nope", NOW)).rejects.toThrow("No such cron.");
  });

  it("holds the message for the model's reset when the gate says so", async () => {
    gate.mockReturnValue({ at: NOW + 60_000 });
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    const card = await runCron(cron.id, NOW);
    expect(scheduled).toEqual([[card.id, card.prompt, NOW + 60_000]]);
    expect(sent).toEqual([]);
  });

  it("gives the card the cron's folder, backend, mode, model and effort", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", backend: "codex", permissionMode: "auto" }, NOW);
    const card = await runCron(cron.id, NOW);
    expect(card.backend).toBe("codex");
    expect(card.permissionMode).toBe("auto");
    expect(card.cwd).toBe(cron.cwd);
  });

  it("stacks the run under the source thread", async () => {
    card("source");
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "source", mode: "fresh" }, NOW);
    const run = await runCron(cron.id, NOW);
    expect(run.cronOf).toBe("source");
  });

  it("gives each run the source's agent", async () => {
    card("source", { agent: "copywriter" });
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "source", mode: "fresh" }, NOW);
    expect((await runCron(cron.id, NOW)).agent).toBe("copywriter");
  });

  it("stacks the run under the cron's oldest live run when the source is gone", async () => {
    card("run-old");
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    saveCron({ ...cron, runs: [{ cardId: "run-old", n: 1, at: NOW }], count: 1 });
    const run = await runCron(cron.id, NOW);
    expect(run.cronOf).toBe("run-old");
  });

  it("stacks the run under the source even when a run is older", async () => {
    card("source");
    card("run-old");
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "source", mode: "fresh" }, NOW);
    saveCron({ ...cron, runs: [{ cardId: "run-old", n: 1, at: NOW }], count: 1 });
    const run = await runCron(cron.id, NOW);
    expect(run.cronOf).toBe("source");
  });

  it("skips an archived run card when stacking", async () => {
    card("run-old", { archived: true });
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    saveCron({ ...cron, runs: [{ cardId: "run-old", n: 1, at: NOW }], count: 1 });
    const run = await runCron(cron.id, NOW);
    expect(run.cronOf).toBeUndefined();
  });

  it("gives a fresh run no fork", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    const run = await runCron(cron.id, NOW);
    expect(run.forkOf).toBeUndefined();
  });

  it("forks a fork run from the source's session, and opens the source's page", async () => {
    card("source", { sessionId: "sess-1" });
    pane.mockReturnValue("http://localhost/source-page");
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "source" }, NOW);
    const run = await runCron(cron.id, NOW);
    expect(run.forkOf).toEqual({ sessionId: "sess-1" });
    expect(opened).toEqual([["http://localhost/source-page", run.id]]);
  });

  it("keeps the resume point in the fork", async () => {
    card("source", { sessionId: "sess-1" });
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "source" }, NOW);
    saveCron({ ...cron, resumeAt: "uuid-anchor" });
    const run = await runCron(cron.id, NOW);
    expect(run.forkOf).toEqual({ sessionId: "sess-1", at: "uuid-anchor" });
  });

  it("opens the cron's own page for a fork, when it has one", async () => {
    card("source", { sessionId: "sess-1" });
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "source" }, NOW);
    saveCron({ ...cron, page: "http://localhost/cron-page" });
    const run = await runCron(cron.id, NOW);
    expect(opened).toEqual([["http://localhost/cron-page", run.id]]);
  });

  it("opens no page for a fresh run", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    await runCron(cron.id, NOW);
    expect(opened).toEqual([]);
  });

  it("opens no page when the source has none to show", async () => {
    card("source", { sessionId: "sess-1" });
    pane.mockReturnValue(undefined);
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "source" }, NOW);
    await runCron(cron.id, NOW);
    expect(opened).toEqual([]);
  });

  it("opens no page for a fork with no source to ask", async () => {
    // A fork cron whose source card is gone: there is no page to open and nothing to ask for one.
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    saveCron({ ...cron, mode: "fork", sessionId: "sess-1" });
    await runCron(cron.id, NOW);
    expect(pane).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  it("keeps the run going when the page won't open", async () => {
    card("source", { sessionId: "sess-1" });
    pane.mockReturnValue("http://localhost/source-page");
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "source" }, NOW);
    await runCron(cron.id, NOW);
    expect(sent).toHaveLength(1);
  });
});
