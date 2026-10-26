import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// The due side of a cron (lib/cron-run.ts): which crons whose time has come get a run, and the clock
// that looks for them. The crons file is real (a temp dir); the cards are fake.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cron-due-"));
process.env.WEFT_DATA = dir;

const g = globalThis as unknown as { __weftState?: unknown; __weftCronTimer?: ReturnType<typeof setInterval> };

const busy = new Set<string>();
const sent: Array<[string, string]> = [];
const scheduled: Array<[string, string, number]> = [];
const opened: Array<[string, string]> = [];
let restart = false;
let restartThrows = false;

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
  restartArmed: () => {
    if (restartThrows) throw new Error("disk gone");
    return restart;
  },
}));

const pane = vi.hoisted(() => vi.fn<(cardId: string) => string | undefined>());
vi.mock("./pane-page", () => ({ panePage: pane }));

vi.mock("./folders", () => ({ resolveFolder: () => "/tmp/project" }));
vi.mock("./settings", () => ({ defaultPermissionMode: () => "default" }));

const { runDueCrons, startCronClock } = await import("./cron-run");
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
  restart = false;
  restartThrows = false;
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

describe("runDueCrons", () => {
  const due = () => createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);

  it("runs a cron whose time has come", async () => {
    const cron = due();
    saveCron({ ...cron, nextAt: NOW - 1000 });
    await runDueCrons(NOW);
    expect(sent).toHaveLength(1);
    expect(getCron(cron.id)!.count).toBe(1);
  });

  it("leaves a cron whose time hasn't come", async () => {
    const cron = due();
    saveCron({ ...cron, nextAt: NOW + 1000 });
    await runDueCrons(NOW);
    expect(sent).toEqual([]);
  });

  it("leaves a cron that is off", async () => {
    const cron = due();
    saveCron({ ...cron, enabled: false, nextAt: NOW - 1000 });
    await runDueCrons(NOW);
    expect(sent).toEqual([]);
  });

  it("leaves a cron with no next run", async () => {
    const cron = due();
    saveCron({ ...cron, nextAt: undefined });
    await runDueCrons(NOW);
    expect(sent).toEqual([]);
  });

  it("waits for the last run to finish", async () => {
    const cron = due();
    card("run-1", { column: "running" });
    saveCron({ ...cron, nextAt: NOW - 1000, runs: [{ cardId: "run-1", n: 1, at: NOW }], count: 1 });
    await runDueCrons(NOW);
    expect(sent).toEqual([]);
  });

  it("waits while the last run's thread is busy", async () => {
    const cron = due();
    card("run-1");
    busy.add("run-1");
    saveCron({ ...cron, nextAt: NOW - 1000, runs: [{ cardId: "run-1", n: 1, at: NOW }], count: 1 });
    await runDueCrons(NOW);
    expect(sent).toEqual([]);
  });

  it("runs when the last run is done", async () => {
    const cron = due();
    card("run-1", { column: "done" });
    saveCron({ ...cron, nextAt: NOW - 1000, runs: [{ cardId: "run-1", n: 1, at: NOW }], count: 1 });
    await runDueCrons(NOW);
    expect(sent).toHaveLength(1);
  });

  it("keeps a failed run on file with its error", async () => {
    const cron = due();
    saveCron({ ...cron, nextAt: NOW - 1000 });
    createCard.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await runDueCrons(NOW);
    const after = getCron(cron.id)!;
    expect(after.runs.at(-1)?.error).toBe("boom");
    expect(after.runs.at(-1)?.cardId).toBe("");
  });

  it("keeps a run that failed with something that isn't an Error", async () => {
    const cron = due();
    saveCron({ ...cron, nextAt: NOW - 1000 });
    createCard.mockImplementationOnce(() => {
      // Not an Error, but something thrown: the run is still kept on file with its message.
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw is the branch under test
      throw "plain string";
    });
    await runDueCrons(NOW);
    expect(getCron(cron.id)!.runs.at(-1)?.error).toBe("plain string");
  });

  it("does nothing while a restart is waiting", async () => {
    restart = true;
    const cron = due();
    saveCron({ ...cron, nextAt: NOW - 1000 });
    await runDueCrons(NOW);
    expect(sent).toEqual([]);
  });

  it("runs each due cron once", async () => {
    const a = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    const b = createCron({ prompt: "q", expr: "0 10 * * *" }, NOW);
    saveCron({ ...a, nextAt: NOW - 1000 });
    saveCron({ ...b, nextAt: NOW - 1000 });
    await runDueCrons(NOW);
    expect(sent).toHaveLength(2);
  });

  it("keeps the run on file when the cron is gone from the file by then", async () => {
    const cron = due();
    saveCron({ ...cron, nextAt: NOW - 1000 });
    createCard.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await runDueCrons(NOW);
    expect(getCron(cron.id)!.runs.at(-1)?.error).toBe("boom");
  });

  it("keeps the failure on file when the cron is gone from the file by then", async () => {
    // The cron is read at the top of the loop, then the run finds it missing: the failure is kept on
    // the copy the loop was holding, and that copy goes back on the file.
    const cron = due();
    saveCron({ ...cron, nextAt: NOW - 1000 });
    createCard.mockImplementationOnce(() => {
      // The card can't be made, and the cron is off the file by the time the error is caught.
      fs.rmSync(path.join(dir, "crons.json"), { force: true });
      throw new Error("boom");
    });
    await runDueCrons(NOW);
    const after = getCron(cron.id)!;
    expect(after.runs.at(-1)?.error).toBe("boom");
    expect(after.runs.at(-1)?.cardId).toBe("");
  });
});

describe("startCronClock", () => {
  afterEach(() => {
    clearInterval(g.__weftCronTimer);
    delete g.__weftCronTimer;
  });

  it("checks right away and then on an interval", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    saveCron({ ...cron, nextAt: NOW - 1000 });
    const spy = vi.spyOn(globalThis, "setInterval");
    startCronClock();
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]?.[1]).toBe(15_000);
    // The first check runs right away, so the due cron has run.
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    spy.mockRestore();
  });

  it("runs the check on the interval too", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" }, NOW);
    saveCron({ ...cron, nextAt: NOW - 1000 });
    const spy = vi.spyOn(globalThis, "setInterval");
    startCronClock();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    // The cron is due again, so the interval's check runs it a second time.
    const after = getCron(cron.id)!;
    saveCron({ ...after, nextAt: NOW - 1000 });
    const tick = spy.mock.calls[0]?.[0] as () => void;
    tick();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    spy.mockRestore();
  });

  it("only starts one clock", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    startCronClock();
    const first = spy.mock.calls.length;
    startCronClock();
    expect(spy.mock.calls.length).toBe(first);
    spy.mockRestore();
  });

  it("logs a check that failed, and keeps the clock running", async () => {
    // A check that throws has to be logged, not left as an unhandled rejection.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    restartThrows = true;
    startCronClock();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(error.mock.calls[0]?.[0]).toBe("[weft] cron check failed:");
    restartThrows = false;
    error.mockRestore();
  });
});
