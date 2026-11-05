import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const m = vi.hoisted(() => ({ stop: vi.fn(), getCard: vi.fn(), getThread: vi.fn(), updateCard: vi.fn(), take: vi.fn(), push: vi.fn() }));
vi.mock("./account", () => ({ accountClient: () => ({}) }));
vi.mock("./runner", () => ({ stop: m.stop }));
vi.mock("./store", () => ({ getCard: m.getCard, getThread: m.getThread, updateCard: m.updateCard }));
vi.mock("./team-takeover", () => ({ takeOverTeamCard: m.take }));

import { answerHandover, askHandover, continueHandovers, HANDOVER_RECENT_MS, handoversFor, noteAsks, type HandoverRow } from "./handover";

type Result = { data: unknown; error: { code?: string; message: string } | null };

// A Supabase client whose every query answers the next of `answers` (the last one repeats), recording each call.
function client(...answers: Result[]) {
  const calls: [string, ...unknown[]][] = [];
  let n = 0;
  const next = () => answers[Math.min(n++, answers.length - 1)] as Result;
  const from = (table: string) => {
    calls.push(["from", table]);
    const b: Record<string, unknown> = {};
    for (const k of ["select", "eq", "in", "gt", "order", "limit", "insert", "update"]) b[k] = (...args: unknown[]) => (calls.push([k, ...args]), b);
    b.single = () => Promise.resolve(next());
    b.then = (ok: (r: Result) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, bad);
    return b;
  };
  return { calls, c: { from } as never };
}

const ok = (data: unknown = [{ id: "h1" }]): Result => ({ data, error: null });
const row = (over: Partial<HandoverRow> = {}): HandoverRow => ({ id: "h1", org_id: "org", card_id: "c1", by_user: "alex", owner_user: "me", status: "asked", branch: null, sha: null, note: null, created_at: "t1", ...over });
const ask = { id: "h1", org: "org", name: "Alex Miller", at: "t1" };
const mine = (over: Partial<Card> = {}) => ({ id: "c1", title: "Fix login", cwd: "/repo", column: "review", handoverAsk: ask, ...over }) as Card;

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getThread.mockReturnValue([{ kind: "tool", name: "Edit", file: "/repo/a.ts", summary: "", id: "t", at: 1 }]);
  m.push.mockResolvedValue({ branch: "weft/handover/c1", sha: "sha1", files: ["a.ts"] });
  vi.spyOn(console, "warn").mockImplementation(() => {}).mockClear();
});

describe("askHandover", () => {
  it("leaves an ask for the card and gives its id", async () => {
    const { c, calls } = client(ok({ id: "h9" }));
    expect(await askHandover("org", "c1", c)).toEqual({ id: "h9" });
    expect(calls).toContainEqual(["insert", { org_id: "org", card_id: "c1" }]);
  });

  it("says when asking isn't set up, or why it failed", async () => {
    await expect(askHandover("org", "c1", client({ data: null, error: { code: "42P01", message: "x" } }).c)).rejects.toThrow("use Take over now");
    await expect(askHandover("org", "c1", client({ data: null, error: { code: "PGRST205", message: "x" } }).c)).rejects.toThrow("use Take over now");
    await expect(askHandover("org", "c1", client({ data: null, error: { message: "denied" } }).c)).rejects.toThrow("Couldn't ask: denied");
  });
});

describe("answerHandover", () => {
  it("refuses a card nobody asks for", async () => {
    m.getCard.mockReturnValueOnce(undefined).mockReturnValueOnce(mine({ handoverAsk: undefined }));
    await expect(answerHandover("c1", true, client(ok()).c, m.push)).rejects.toThrow("Nobody's asking");
    await expect(answerHandover("c1", true, client(ok()).c, m.push)).rejects.toThrow("Nobody's asking");
  });

  it("says not now, only to an ask still waiting", async () => {
    m.getCard.mockReturnValue(mine());
    const { c, calls } = client(ok());
    expect(await answerHandover("c1", false, c, m.push)).toEqual({});
    expect(calls).toContainEqual(["update", { status: "declined" }]);
    expect(calls).toContainEqual(["eq", "status", "asked"]);
    expect(m.updateCard).toHaveBeenCalledWith("c1", { handoverAsk: undefined });
    expect(m.push).not.toHaveBeenCalled();
  });

  it("on yes stops a running card, pushes the files it changed and says where", async () => {
    m.getCard.mockReturnValue(mine({ column: "running" }));
    const { c, calls } = client(ok());
    expect(await answerHandover("c1", true, c, m.push)).toEqual({ branch: "weft/handover/c1" });
    expect(m.stop).toHaveBeenCalledWith("c1");
    const [cwd, files, branch, message] = m.push.mock.calls[0] as [string, string[], string, string];
    expect([cwd, files, branch]).toEqual(["/repo", ["/repo/a.ts"], "weft/handover/c1"]);
    expect(message).toContain('hand "Fix login" over to Alex Miller');
    expect(calls.filter((call) => call[0] === "update").map((call) => call[1])).toEqual([{ status: "pushing" }, { status: "pushed", branch: "weft/handover/c1", sha: "sha1" }]);
  });

  it("leaves a card that isn't running alone", async () => {
    m.getCard.mockReturnValue(mine());
    await answerHandover("c1", true, client(ok()).c, m.push);
    expect(m.stop).not.toHaveBeenCalled();
  });

  it("refuses when the ask was called off meanwhile", async () => {
    m.getCard.mockReturnValue(mine());
    await expect(answerHandover("c1", true, client(ok([])).c, m.push)).rejects.toThrow("Alex Miller isn't asking anymore.");
    expect(m.push).not.toHaveBeenCalled();
  });

  it("says a push failed, on the ask and to you", async () => {
    m.getCard.mockReturnValue(mine());
    m.push.mockRejectedValueOnce(new Error("rejected: no access"));
    const { c, calls } = client(ok());
    await expect(answerHandover("c1", true, c, m.push)).rejects.toThrow("Couldn't push this card's work: rejected: no access");
    expect(calls).toContainEqual(["update", { status: "failed", note: "rejected: no access" }]);
    m.push.mockRejectedValueOnce("plain");
    await expect(answerHandover("c1", true, client(ok(), { data: null, error: { message: "down" } }).c, m.push)).rejects.toThrow("plain");
  });

  it("throws when the answer can't be written", async () => {
    m.getCard.mockReturnValue(mine());
    await expect(answerHandover("c1", false, client({ data: null, error: { message: "down" } }).c, m.push)).rejects.toThrow("Couldn't answer the ask: down");
  });

  it("uses the account and the real push by default", async () => {
    m.getCard.mockReturnValue(undefined);
    await expect(answerHandover("c1", true)).rejects.toThrow("Nobody's asking");
  });
});

describe("noteAsks", () => {
  it("puts each open ask on its card once, and takes gone ones off", () => {
    const cards: Record<string, Card> = {
      c1: mine({ handoverAsk: undefined }),
      c2: mine({ id: "c2", handoverAsk: { ...ask, id: "h2" } }),
      c3: mine({ id: "c3", handoverAsk: { ...ask, id: "old" } }),
      c4: mine({ id: "c4", handoverAsk: { ...ask, id: "h4", org: "other-org" } }),
    };
    m.getCard.mockImplementation((id: string) => cards[id]);
    noteAsks([row(), row({ id: "h2", card_id: "c2" }), row({ id: "h5", card_id: "gone" }), row({ id: "h6", card_id: "c1", status: "declined" })], ["org"], () => "Alex", () => Object.values(cards));
    expect(m.updateCard.mock.calls).toEqual([
      ["c1", { handoverAsk: { id: "h1", org: "org", name: "Alex", at: "t1" } }],
      ["c3", { handoverAsk: undefined }],
    ]);
  });
});

describe("continueHandovers", () => {
  it("takes a pushed ask over from its branch, once, after marking it taken", async () => {
    const { c, calls } = client(ok());
    await continueHandovers([row({ status: "pushed", branch: "weft/handover/c1", sha: "sha1" }), row({ id: "h2", status: "asked" }), row({ id: "h3", status: "pushed" })], c, m.take);
    expect(calls).toContainEqual(["update", { status: "taken" }]);
    expect(m.take.mock.calls).toEqual([["org", "c1", c, undefined, { branch: "weft/handover/c1", sha: "sha1" }]]);
  });

  it("leaves one another read already took", async () => {
    await continueHandovers([row({ status: "pushed", branch: "b" })], client(ok([])).c, m.take);
    expect(m.take).not.toHaveBeenCalled();
  });

  it("calls the ask off with why when the takeover fails", async () => {
    m.take.mockRejectedValueOnce(new Error("Check out acme/app first")).mockRejectedValueOnce("odd");
    const { c, calls } = client(ok());
    await continueHandovers([row({ status: "pushed", branch: "b" })], c, m.take);
    expect(m.take.mock.calls[0]?.[4]).toEqual({ branch: "b" });
    expect(calls).toContainEqual(["update", { status: "cancelled", note: "Couldn't start your card: Check out acme/app first" }]);
    await continueHandovers([row({ status: "pushed", branch: "b" })], client(ok(), { data: null, error: { message: "down" } }).c, m.take);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("uses the account and the real takeover by default", async () => {
    await continueHandovers([]);
  });
});

describe("handoversFor", () => {
  it("reads nothing with no workspace", async () => {
    const { c, calls } = client(ok());
    expect(await handoversFor(c, "owner", "me", [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("reads the asks waiting on your cards", async () => {
    const { c, calls } = client(ok([row()]));
    expect(await handoversFor(c, "owner", "me", ["org"])).toEqual([row()]);
    expect(calls).toContainEqual(["eq", "owner_user", "me"]);
    expect(calls).toContainEqual(["eq", "status", "asked"]);
  });

  it("reads your own asks from the last day", async () => {
    const { c, calls } = client(ok(null));
    expect(await handoversFor(c, "asker", "me", ["org"], HANDOVER_RECENT_MS + 1000)).toEqual([]);
    expect(calls).toContainEqual(["eq", "by_user", "me"]);
    expect(calls).toContainEqual(["gt", "created_at", new Date(1000).toISOString()]);
  });

  it("has none quietly without the table, and warns on other errors", async () => {
    expect(await handoversFor(client({ data: null, error: { code: "42P01", message: "x" } }).c, "owner", "me", ["org"])).toEqual([]);
    expect(await handoversFor(client({ data: null, error: { code: "PGRST205", message: "x" } }).c, "owner", "me", ["org"])).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
    expect(await handoversFor(client({ data: null, error: { message: "down" } }).c, "owner", "me", ["org"])).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});
