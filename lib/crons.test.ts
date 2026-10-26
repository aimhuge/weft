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

const { createCron, nextFor } = await import("./crons");
const { getCron } = await import("./cron-store");

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

describe("nextFor", () => {
  it("is the next time the cron fires, strictly after the given one", () => {
    const at = nextFor({ expr: "0 9 * * *", enabled: true }, Date.now());
    expect(at).toBeGreaterThan(Date.now());
    expect(new Date(at!).getHours()).toBe(9);
  });

  it("is nothing when the cron is off", () => {
    expect(nextFor({ expr: "0 9 * * *", enabled: false }, Date.now())).toBeUndefined();
  });

  it("is nothing past the cron's end", () => {
    const past = Date.now() - 1000;
    expect(nextFor({ expr: "0 9 * * *", enabled: true, startsAt: past, endsAt: past }, Date.now())).toBeUndefined();
  });

  it("keeps to the cron's start", () => {
    const start = Date.now() + 60 * 60 * 1000;
    const at = nextFor({ expr: "0 9 * * *", enabled: true, startsAt: start }, Date.now());
    expect(at).toBeGreaterThanOrEqual(start);
  });
});

describe("createCron", () => {
  it("makes a fresh cron with no source card", () => {
    const cron = createCron({ prompt: "  do the thing  ", expr: " 0 9 * * * " });
    expect(cron.prompt).toBe("do the thing");
    expect(cron.expr).toBe("0 9 * * *");
    expect(cron.mode).toBe("fresh");
    expect(cron.enabled).toBe(true);
    expect(cron.by).toBe("you");
    expect(cron.count).toBe(0);
    expect(cron.runs).toEqual([]);
    expect(cron.nextAt).toBeGreaterThan(Date.now());
    expect(getCron(cron.id)?.id).toBe(cron.id);
  });

  it("names it from the prompt when no name is given", () => {
    const cron = createCron({ prompt: "Check the deploys and report back", expr: "0 9 * * *" });
    expect(cron.name).toBe("Check the deploys and report back");
  });

  it("takes the name, mode, folder, backend and permission mode it was given", () => {
    const cron = createCron({
      prompt: "p",
      expr: "0 9 * * *",
      name: "  My cron  ",
      mode: "fresh",
      cwd: "/tmp",
      backend: "codex",
      permissionMode: "auto",
      enabled: false,
      by: "thread",
    });
    expect(cron.name).toBe("My cron");
    expect(cron.mode).toBe("fresh");
    expect(cron.cwd).toBe("/tmp/folder");
    expect(folders).toHaveBeenCalledWith("/tmp");
    expect(cron.backend).toBe("codex");
    expect(cron.permissionMode).toBe("auto");
    expect(cron.enabled).toBe(false);
    expect(cron.by).toBe("thread");
  });

  it("falls back to the default permission mode when there is no source and none given", () => {
    mode.mockReturnValue("plan");
    expect(createCron({ prompt: "p", expr: "0 9 * * *" }).permissionMode).toBe("plan");
  });

  it("keeps the start and end it was given", () => {
    const startsAt = Date.now() + 1000;
    const endsAt = Date.now() + 100_000;
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", startsAt, endsAt });
    expect(cron.startsAt).toBe(startsAt);
    expect(cron.endsAt).toBe(endsAt);
  });

  it("refuses a blank prompt", () => {
    expect(() => createCron({ prompt: "   ", expr: "0 9 * * *" })).toThrow("Write what each run should do.");
  });

  it("refuses a prompt that isn't there at all", () => {
    expect(() => createCron({ prompt: undefined as unknown as string, expr: "0 9 * * *" })).toThrow("Write what each run should do.");
  });

  it("refuses a schedule that isn't a cron", () => {
    expect(() => createCron({ prompt: "p", expr: "0 9 *" })).toThrow("five fields");
  });

  it("refuses an end before its start", () => {
    const now = Date.now();
    expect(() => createCron({ prompt: "p", expr: "0 9 * * *", startsAt: now, endsAt: now - 1000 })).toThrow("ends before it starts");
  });

  it("refuses a card that isn't there", () => {
    expect(() => createCron({ prompt: "p", expr: "0 9 * * *", cardId: "nope" })).toThrow("No such card.");
  });

  it("refuses the copilot as a source", () => {
    card("co", { role: "copilot" });
    expect(() => createCron({ prompt: "p", expr: "0 9 * * *", cardId: "co" })).toThrow("copilot can't run on a cron");
  });

  it("forks a source thread that has run, and takes its folder, model and mode", () => {
    card("s1", { title: "Source", sessionId: "sess-1", model: "sonnet", effort: "high", backend: "claude" });
    pane.mockReturnValue("http://localhost/page");
    tip.mockReturnValue("uuid-tip");
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1" });
    expect(cron.mode).toBe("fork");
    expect(cron.sourceId).toBe("s1");
    expect(cron.sessionId).toBe("sess-1");
    expect(cron.resumeAt).toBe("uuid-tip");
    expect(cron.page).toBe("http://localhost/page");
    expect(cron.cwd).toBe("/tmp/project");
    expect(cron.model).toBe("sonnet");
    expect(cron.effort).toBe("high");
    expect(cron.name).toBe("Source");
  });

  it("keeps a source copywriter's agent, so every run writes in Weft's voice", () => {
    card("s1", { sessionId: "sess-1", agent: "copywriter" });
    expect(createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1" }).agent).toBe("copywriter");
    card("s2", { sessionId: "sess-2" });
    expect(createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s2" })).not.toHaveProperty("agent");
  });

  it("refuses to fork a thread that has never run", () => {
    card("s1");
    expect(() => createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1" })).toThrow("can be forked on a cron");
  });

  it("refuses to fork a backend that has no forkable sessions", () => {
    card("s1", { sessionId: "sess-1", backend: "codex" });
    expect(() => createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1" })).toThrow("can be forked on a cron");
  });

  it("forks a puku thread", () => {
    card("s1", { sessionId: "sess-1", backend: "puku" });
    expect(createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1" }).sessionId).toBe("sess-1");
  });

  it("forks at a message of the thread", () => {
    card("s1", { sessionId: "sess-1" });
    threads.set("s1", [{ id: "m1", kind: "user", text: "do this", at: 1 }]);
    rewindPoint.mockReturnValue("uuid-anchor");
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1", fromMessage: "m1" });
    expect(rewindPoint).toHaveBeenCalledWith("sess-1", "m1");
    expect(cron.resumeAt).toBe("uuid-anchor");
    expect(cron.sessionId).toBe("sess-1");
  });

  it("refuses a message that isn't in the thread", () => {
    card("s1", { sessionId: "sess-1" });
    threads.set("s1", []);
    expect(() => createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1", fromMessage: "nope" })).toThrow("isn't in this thread");
  });

  it("refuses a message that isn't a user message", () => {
    card("s1", { sessionId: "sess-1" });
    threads.set("s1", [{ kind: "assistant", text: "hi", at: 1 }]);
    expect(() => createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1", fromMessage: "m1" })).toThrow("isn't in this thread");
  });

  it("refuses a message Weft can't find in the session", () => {
    card("s1", { sessionId: "sess-1" });
    threads.set("s1", [{ id: "m1", kind: "user", text: "do this", at: 1 }]);
    rewindPoint.mockReturnValue(undefined);
    expect(() => createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1", fromMessage: "m1" })).toThrow("can't find that message");
  });

  it("forks nothing when the message opened the session, keeping only its page", () => {
    card("s1", { sessionId: "sess-1" });
    threads.set("s1", [{ id: "m1", kind: "user", text: "do this", at: 1, page: "http://localhost/msg" }]);
    rewindPoint.mockReturnValue(null);
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1", fromMessage: "m1" });
    expect(cron.sessionId).toBeUndefined();
    expect(cron.resumeAt).toBeUndefined();
    expect(cron.page).toBe("http://localhost/msg");
  });

  it("falls back to the source's latest page when the message has none", () => {
    card("s1", { sessionId: "sess-1" });
    threads.set("s1", [{ id: "m1", kind: "user", text: "do this", at: 1 }]);
    pane.mockReturnValue("http://localhost/latest");
    rewindPoint.mockReturnValue("uuid-anchor");
    expect(createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1", fromMessage: "m1" }).page).toBe("http://localhost/latest");
  });

  it("takes a fresh run off a source card without forking it", () => {
    card("s1", { sessionId: "sess-1" });
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", cardId: "s1", mode: "fresh" });
    expect(cron.mode).toBe("fresh");
    expect(cron.sessionId).toBeUndefined();
    expect(cron.sourceId).toBe("s1");
  });
});
