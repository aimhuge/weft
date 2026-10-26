// Changing, deleting and running crons that exist (lib/crons.ts); making them is in ./crons.test.ts.
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

// The crons logic (lib/crons.ts) against fake stores: the crons file is a real temp file, the cards
// and threads are in memory.

const cards = new Map<string, Card>();
const threads = new Map<string, ThreadItem[]>();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  getThread: (id: string) => threads.get(id) ?? [],
  DATA_DIR: "/tmp/weft-crons-test",
}));

const rewindPoint = vi.hoisted(() => vi.fn<(sessionId: string, messageId: string) => string | null | undefined>());
const tip = vi.hoisted(() => vi.fn<(sessionId: string) => string | undefined>());
vi.mock("./rewind", () => ({ sessionRewindPoint: rewindPoint, sessionTip: tip }));

const pane = vi.hoisted(() => vi.fn<(cardId: string) => string | undefined>());
vi.mock("./pane-page", () => ({ panePage: pane }));

const mode = vi.hoisted(() => vi.fn<() => string>());
vi.mock("./settings", () => ({ defaultPermissionMode: () => mode() }));

const folders = vi.hoisted(() => vi.fn<(raw: unknown) => string>());
vi.mock("./folders", () => ({ resolveFolder: folders }));

const { createCron, updateCron, deleteCron, recordRun, cronsFrom } = await import("./crons");
const { listCrons, getCron } = await import("./cron-store");

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

// The crons file lives in the mocked store's DATA_DIR, so it has to go between tests.
const cronsFile = () => path.join("/tmp/weft-crons-test", "crons.json");

beforeEach(() => {
  cards.clear();
  threads.clear();
  fs.rmSync(cronsFile(), { force: true });
  vi.clearAllMocks();
  mode.mockReturnValue("auto");
  folders.mockReturnValue("/tmp/folder");
  pane.mockReturnValue(undefined);
  tip.mockReturnValue(undefined);
  rewindPoint.mockReturnValue(undefined);
});

describe("updateCron", () => {
  it("changes the prompt, schedule and name, and keeps the rest", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", name: "One" });
    const next = updateCron(cron.id, { prompt: "  q  ", expr: " 0 10 * * * ", name: "  Two  " });
    expect(next.prompt).toBe("q");
    expect(next.expr).toBe("0 10 * * *");
    expect(next.name).toBe("Two");
    expect(next.id).toBe(cron.id);
    expect(getCron(cron.id)?.prompt).toBe("q");
  });

  it("keeps the old name when the new one is blank", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", name: "One" });
    expect(updateCron(cron.id, { name: "   " }).name).toBe("One");
  });

  it("turns the cron on and off", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    expect(updateCron(cron.id, { enabled: false }).enabled).toBe(false);
    expect(updateCron(cron.id, { enabled: true }).enabled).toBe(true);
  });

  it("refuses to switch a fresh cron to fork", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    expect(() => updateCron(cron.id, { mode: "fork" })).toThrow("no thread to fork");
  });

  it("switches a forked cron to fresh", () => {
    card("s1", { sessionId: "sess-1" });
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1" });
    expect(updateCron(cron.id, { mode: "fresh" }).mode).toBe("fresh");
  });

  it("refuses a blank prompt and a schedule that isn't a cron", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    expect(() => updateCron(cron.id, { prompt: "  " })).toThrow("Write what each run should do.");
    expect(() => updateCron(cron.id, { expr: "0 9 *" })).toThrow("five fields");
  });

  it("refuses a cron that isn't there", () => {
    expect(() => updateCron("nope", { name: "x" })).toThrow("No such cron.");
  });
});

describe("deleteCron", () => {
  it("takes the cron off the file", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    deleteCron(cron.id);
    expect(getCron(cron.id)).toBeUndefined();
  });

  it("refuses a cron that isn't there", () => {
    expect(() => deleteCron("nope")).toThrow("No such cron.");
  });
});

describe("recordRun", () => {
  it("counts the run, keeps it, and sets the next one after now", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    const now = Date.now();
    const ran = recordRun(cron, { cardId: "card-1", n: 1, at: now }, now);
    expect(ran.count).toBe(1);
    expect(ran.runs).toEqual([{ cardId: "card-1", n: 1, at: now }]);
    expect(ran.nextAt).toBeGreaterThan(now);
    expect(getCron(cron.id)?.count).toBe(1);
  });

  it("keeps only the last few runs", async () => {
    const { RUNS_KEPT } = await import("./cron-types");
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    let latest = cron;
    for (let i = 1; i <= RUNS_KEPT + 5; i++) latest = recordRun(latest, { cardId: `c${i}`, n: i, at: i }, i);
    expect(latest.runs).toHaveLength(RUNS_KEPT);
    expect(latest.runs[latest.runs.length - 1]?.n).toBe(RUNS_KEPT + 5);
    expect(latest.count).toBe(RUNS_KEPT + 5);
  });

  it("counts the highest run number, not the number of runs", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    expect(recordRun(cron, { cardId: "c9", n: 9, at: 1 }, 1).count).toBe(9);
  });
});

describe("cronsFrom", () => {
  it("is the crons made from that card", () => {
    card("s1");
    card("s2");
    const a = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1", mode: "fresh" });
    const b = createCron({ prompt: "p", expr: "0 10 * * *", cardId: "s1", mode: "fresh" });
    createCron({ prompt: "p", expr: "0 11 * * *", cardId: "s2", mode: "fresh" });
    createCron({ prompt: "p", expr: "0 12 * * *" });
    expect(cronsFrom("s1").map((c) => c.id)).toEqual([a.id, b.id]);
    expect(cronsFrom("nobody")).toEqual([]);
  });
});

describe("the crons file", () => {
  it("holds every cron it was given", () => {
    const a = createCron({ prompt: "p", expr: "0 9 * * *" });
    createCron({ prompt: "q", expr: "0 10 * * *" });
    expect(listCrons().map((c) => c.id)).toContain(a.id);
  });
});
