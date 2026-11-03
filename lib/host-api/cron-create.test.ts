// cron.create against a local store: the crons file is a real temp file, the cards in memory. A cron made from a card
// takes the card's folder, CLI and mode; a host narrowing it from the network sets the mode it may fire in.
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../types";

const dir = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/weft-cron-create-${process.pid}`);
const cards = vi.hoisted(() => new Map<string, Card>());
vi.mock("../store", () => ({ getCard: (id: string) => cards.get(id), getThread: () => [], DATA_DIR: dir }));
vi.mock("../bus", () => ({ publish: vi.fn() }));
vi.mock("../pane-page", () => ({ panePage: () => undefined }));
vi.mock("../rewind", () => ({ sessionRewindPoint: () => undefined, sessionTip: () => "tip-1" }));
const runCron = vi.hoisted(() => vi.fn((id: string) => Promise.resolve({ id: `run-of-${id}` })));
vi.mock("../cron-run", () => ({ runCron }));

const { cronCreateVerb } = await import("./cron-create");
const { listCrons } = await import("../cron-store");

const card = (over: Partial<Card> = {}): Card =>
  ({ id: "c1", title: "Nightly", prompt: "p", cwd: "/work/repo", backend: "claude", permissionMode: "bypassPermissions", column: "review", ...over }) as Card;

beforeEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  cards.clear();
  cards.set("c1", card());
  vi.clearAllMocks();
});

describe("cron.create", () => {
  it("makes a fresh cron from the card, in its folder, CLI and mode, kept in the crons file", async () => {
    const { cron } = await cronCreateVerb({ id: "c1", prompt: " tidy up ", expr: "0 9 * * *", mode: "fresh" });
    expect(cron).toMatchObject({ prompt: "tidy up", expr: "0 9 * * *", mode: "fresh", cwd: "/work/repo", backend: "claude", permissionMode: "bypassPermissions", sourceId: "c1", by: "you" });
    expect(listCrons().map((c) => c.id)).toEqual([cron.id]);
    expect(runCron).not.toHaveBeenCalled();
  });

  it("narrows the mode when the host names one, and leaves it when it's the card's own", async () => {
    const { cron } = await cronCreateVerb({ id: "c1", prompt: "p", expr: "0 9 * * *", mode: "fresh", permissionMode: "default" });
    expect(cron.permissionMode).toBe("default");
    expect(listCrons()[0]?.permissionMode).toBe("default");
    cards.set("c2", card({ id: "c2", permissionMode: "auto" }));
    expect((await cronCreateVerb({ id: "c2", prompt: "p", expr: "0 9 * * *", mode: "fresh", permissionMode: "auto" })).cron.permissionMode).toBe("auto");
  });

  it("forks a thread that has run, and fires the first run when asked", async () => {
    cards.set("c1", card({ sessionId: "s1" }));
    const { cron } = await cronCreateVerb({ id: "c1", prompt: "p", expr: "0 9 * * *", runNow: true });
    expect(cron).toMatchObject({ mode: "fork", sessionId: "s1", resumeAt: "tip-1" });
    expect(runCron).toHaveBeenCalledWith(cron.id);
  });

  it("answers the cron as it was made when its first run took it away", async () => {
    const { deleteCron } = await import("../crons");
    runCron.mockImplementationOnce((id: string) => {
      deleteCron(id);
      return Promise.resolve({ id: "run-1" });
    });
    const { cron } = await cronCreateVerb({ id: "c1", prompt: "p", expr: "0 9 * * *", mode: "fresh", runNow: true });
    expect(cron.prompt).toBe("p");
    expect(listCrons()).toEqual([]);
  });

  it("refuses a card it doesn't have, and a bad schedule", async () => {
    await expect(cronCreateVerb({ id: "nope", prompt: "p", expr: "0 9 * * *" })).rejects.toThrow("No such card.");
    await expect(cronCreateVerb({ id: "c1", prompt: "p", expr: "whenever" })).rejects.toThrow();
    expect(listCrons()).toEqual([]);
  });
});
