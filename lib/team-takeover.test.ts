import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

const m = vi.hoisted(() => ({
  threadPageIn: vi.fn(),
  complete: vi.fn(),
  createCardFromBody: vi.fn(),
  sendMessage: vi.fn(),
  getCard: vi.fn(),
  replaceThread: vi.fn(),
  updateCard: vi.fn(),
  openCardRows: vi.fn(),
}));

vi.mock("./account", () => ({ accountClient: () => ({}) }));
vi.mock("./cloud-thread-read", () => ({ threadPageIn: m.threadPageIn }));
vi.mock("./haiku", () => ({ complete: m.complete }));
vi.mock("./new-card", () => ({ createCardFromBody: m.createCardFromBody }));
vi.mock("./runner", () => ({ sendMessage: m.sendMessage }));
vi.mock("./store", () => ({ getCard: m.getCard, replaceThread: m.replaceThread, updateCard: m.updateCard }));
vi.mock("./team-board", () => ({ repoFolders: () => new Map() }));
vi.mock("./worker-board-open", () => ({ openCardRows: m.openCardRows }));

import { takeOverTeamCard, wholeThread } from "./team-takeover";

type Result = { data: unknown; error: { code?: string; message: string } | null };

// A Supabase client: each table answers its own result, and every call is recorded.
function client(uid: string | null, answers: Record<string, Result>) {
  const calls: [string, ...unknown[]][] = [];
  const from = (table: string) => {
    calls.push(["from", table]);
    const b: Record<string, unknown> = {};
    for (const k of ["select", "eq", "upsert"]) b[k] = (...args: unknown[]) => (calls.push([k, ...args]), b);
    const answer = answers[table] as Result;
    b.maybeSingle = () => Promise.resolve(answer);
    b.then = (ok: (r: Result) => unknown) => Promise.resolve(answer).then(ok);
    return b;
  };
  return { calls, c: { auth: { getSession: () => Promise.resolve({ data: { session: uid ? { user: { id: uid } } : null } }) }, from } as never };
}

const theirCard = { id: "z1", title: "Fix login", cwd: "/Users/z/app", remaining: "tests", tags: ["bug"], lastLine: "Halfway" } as Card;
const cardRow = (over: Record<string, unknown> = {}) => ({ data: { card_id: "z1", owner_user: "zulker", repo: "Acme/App", card: theirCard, deleted: false, ...over }, error: null });
const ok = (over: Record<string, Result> = {}) => ({
  cloud_cards: cardRow(),
  profiles: { data: { display_name: "Zulker Nayeen" }, error: null },
  cloud_card_takeovers: { data: null, error: null },
  ...over,
});
const folders = () => new Map([["acme/app", "/Users/me/app"]]);
const say = (text: string, at: number): ThreadItem => ({ kind: "assistant", text, at });
// The brief the new card's thread was given, and the body its card was made from.
const sentBrief = () => ((m.replaceThread.mock.calls[0] as [string, { brief?: string }[]])[1][1] as { brief: string }).brief;
const madeFrom = () => (m.createCardFromBody.mock.calls[0] as [{ prompt: string; tags: string[] }])[0];

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.openCardRows.mockImplementation((_org: string, rows: unknown[]) => Promise.resolve(rows));
  m.threadPageIn.mockResolvedValue({ items: [say("hi", 1)], start: 0, total: 1 });
  m.complete.mockResolvedValue("The summary.");
  m.createCardFromBody.mockImplementation((body: { prompt: string }) => ({ id: "new", title: "Fix login", prompt: body.prompt }));
  m.getCard.mockImplementation((id: string) => ({ id, takenFrom: { card: "z1" } }));
  vi.spyOn(console, "warn").mockImplementation(() => {}).mockClear();
});

describe("wholeThread", () => {
  it("walks back a page at a time, oldest first", async () => {
    m.threadPageIn.mockResolvedValueOnce({ items: [say("c", 3)], start: 2, total: 3 }).mockResolvedValueOnce({ items: [say("a", 1), say("b", 2)], start: 0, total: 3 });
    const { c } = client("me", {});
    expect(await wholeThread(c, "org", "z1")).toEqual([say("a", 1), say("b", 2), say("c", 3)]);
    expect(m.threadPageIn.mock.calls.map((call) => call[3] as number | undefined)).toEqual([undefined, 2]);
  });

  it("stops at an empty page and throws when a page can't be read", async () => {
    m.threadPageIn.mockResolvedValueOnce({ items: [], start: 5, total: 5 });
    const { c } = client("me", {});
    expect(await wholeThread(c, "org", "z1")).toEqual([]);
    m.threadPageIn.mockResolvedValueOnce(null);
    await expect(wholeThread(c, "org", "z1")).rejects.toThrow("Couldn't read that card's thread.");
  });
});

describe("takeOverTeamCard", () => {
  it("makes a card of yours in your checkout, with their thread, the brief, the first turn and the mark", async () => {
    const { c, calls } = client("me", ok());
    const out = await takeOverTeamCard("org", "z1", c, folders);
    expect(m.createCardFromBody).toHaveBeenCalledWith({ prompt: 'Take over Zulker Nayeen\'s card "Fix login" and carry on from where it stands. Still open: tests.', cwd: "/Users/me/app", title: "Fix login", tags: ["bug"] });
    expect(m.updateCard).toHaveBeenCalledWith("new", { takenFrom: { org: "org", card: "z1", owner: "zulker", name: "Zulker Nayeen" } });
    const [, items] = m.replaceThread.mock.calls[0] as [string, ThreadItem[]];
    expect(items[0]).toEqual(say("hi", 1));
    expect(items[1]).toMatchObject({ kind: "spliced" });
    const brief = (items[1] as { brief: string }).brief;
    expect(brief).toContain("The summary.");
    expect(brief).toContain("checkout of acme/app");
    const [id, text, opts] = m.sendMessage.mock.calls[0] as [string, string, { cli: string }];
    expect([id, opts.cli]).toEqual(["new", `${brief}${text}`]);
    expect(calls).toContainEqual(["upsert", { org_id: "org", card_id: "z1", new_card_id: "new" }, { onConflict: "org_id,card_id,by_user", ignoreDuplicates: true }]);
    expect(out).toEqual({ card: { id: "new", takenFrom: { card: "z1" } }, marked: true });
  });

  it("falls back to the card's last line, a default name and no tags", async () => {
    m.complete.mockRejectedValueOnce(new Error("no haiku"));
    m.getCard.mockReturnValue(undefined);
    const { c } = client("me", ok({ profiles: { data: null, error: null }, cloud_cards: cardRow({ card: { ...theirCard, tags: undefined } }) }));
    const out = await takeOverTeamCard("org", "z1", c, folders);
    expect(sentBrief()).toContain("Halfway");
    expect(madeFrom().tags).toEqual([]);
    expect(madeFrom().prompt).toContain("A teammate's card");
    expect(out.card.id).toBe("new");
  });

  it("says when there's no summary at all", async () => {
    m.complete.mockResolvedValueOnce("  ");
    const { c } = client("me", ok({ cloud_cards: cardRow({ card: { ...theirCard, lastLine: undefined } }) }));
    await takeOverTeamCard("org", "z1", c, folders);
    expect(sentBrief()).toContain("(no summary available");
  });

  it("starts from the branch they handed over on", async () => {
    const { c } = client("me", ok());
    await takeOverTeamCard("org", "z1", c, folders, { branch: "weft/handover/z1", sha: "abc" });
    expect(m.updateCard).toHaveBeenCalledWith("new", { takenFrom: { org: "org", card: "z1", owner: "zulker", name: "Zulker Nayeen", branch: "weft/handover/z1" } });
    expect(sentBrief()).toContain("`git fetch origin weft/handover/z1`");
    expect(madeFrom().prompt).toContain("handed over on `weft/handover/z1`");
  });

  it("still takes over when the mark can't go up", async () => {
    const { c } = client("me", ok({ cloud_card_takeovers: { data: null, error: { code: "42P01", message: "missing" } } }));
    expect((await takeOverTeamCard("org", "z1", c, folders)).marked).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
    const bad = client("me", ok({ cloud_card_takeovers: { data: null, error: { message: "denied" } } }));
    expect((await takeOverTeamCard("org", "z1", bad.c, folders)).marked).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  it("refuses signed out, a card that's gone or yours, and a repo not checked out here", async () => {
    await expect(takeOverTeamCard("org", "z1", client(null, ok()).c, folders)).rejects.toThrow("Sign in");
    await expect(takeOverTeamCard("org", "z1", client("me", ok({ cloud_cards: { data: null, error: null } })).c, folders)).rejects.toThrow("isn't there anymore");
    await expect(takeOverTeamCard("org", "z1", client("me", ok({ cloud_cards: cardRow({ deleted: true }) })).c, folders)).rejects.toThrow("isn't there anymore");
    await expect(takeOverTeamCard("org", "z1", client("zulker", ok()).c, folders)).rejects.toThrow("already yours");
    await expect(takeOverTeamCard("org", "z1", client("me", ok()).c, () => new Map())).rejects.toThrow("Check out Acme/App");
    await expect(takeOverTeamCard("org", "z1", client("me", ok({ cloud_cards: cardRow({ repo: null }) })).c, folders)).rejects.toThrow("Check out its repo");
    await expect(takeOverTeamCard("org", "z1", client("me", ok({ cloud_cards: { data: null, error: { message: "down" } } })).c, folders)).rejects.toThrow("Couldn't read that card: down");
    expect(m.createCardFromBody).not.toHaveBeenCalled();
  });

  it("refuses a row that won't open", async () => {
    m.openCardRows.mockResolvedValueOnce([]);
    await expect(takeOverTeamCard("org", "z1", client("me", ok()).c, folders)).rejects.toThrow("isn't there anymore");
  });

  it("uses the account and this Mac's folders by default", async () => {
    await expect(takeOverTeamCard("org", "z1")).rejects.toThrow();
  });
});
