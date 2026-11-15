import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardShareState } from "./share-types";
import type { ThreadItem } from "./types";

// lib/share-tool.ts: share_card on a Mac (the Share dialog's write) and on a worker (worker_share_card), the lead-page
// check, and the consent stamp.
const h = vi.hoisted(() => ({
  cards: new Map<string, Record<string, unknown>>(),
  threads: new Map<string, unknown[]>(),
  decorated: [] as [string, Record<string, unknown>][],
  worker: false,
  shareCard: undefined as undefined | ((a: unknown) => Promise<unknown>),
  setCardShare: vi.fn(),
  syncNow: vi.fn(),
}));

vi.mock("./store", () => ({
  getCard: (id: string) => h.cards.get(id),
  getThread: (id: string) => h.threads.get(id) ?? [],
  decorateCard: (id: string, patch: Record<string, unknown>) => {
    h.decorated.push([id, patch]);
    Object.assign(h.cards.get(id) ?? {}, patch);
  },
}));
vi.mock("./worker-pane", () => ({ onWorker: () => h.worker }));
vi.mock("./worker-board-link", () => ({ boardLink: () => ({ shareCard: h.shareCard }) }));
vi.mock("./card-share", () => ({ setCardShare: h.setCardShare }));
vi.mock("./cloud-sync", () => ({ syncNow: h.syncNow }));

const { leadPage, samePage, shareCard, shareOnMac, shareOnWorker, shareTool, PUBLISH_TRIES } = await import("./share-tool");

const ok = (url: string | null): CardShareState => ({ kind: "ok", id: "abcdefghijklmnopqrstuv", url, mode: "public", hasPassword: false, slug: "x", showChat: false });
const openUrl = (summary: string, at: number) => ({ kind: "tool", name: "mcp__browser__open_url", summary, at }) as unknown as ThreadItem;
const noWait = () => Promise.resolve();

beforeEach(() => {
  h.cards.clear();
  h.threads.clear();
  h.decorated.length = 0;
  h.worker = false;
  h.shareCard = undefined;
  h.setCardShare.mockReset();
  h.syncNow.mockReset();
});

describe("leadPage / samePage", () => {
  it("is the newest open_url or page a message carried", () => {
    const user = { kind: "user", text: "hi", page: "/show/b.html", at: 5 } as unknown as ThreadItem;
    expect(leadPage([openUrl("/show/a.html", 1), user, openUrl("/show/c.html", 3)])).toBe("/show/b.html");
    expect(leadPage([{ kind: "tool", name: "Bash", summary: "ls", at: 9 } as unknown as ThreadItem])).toBeNull();
  });

  it("reads file:// and a trailing slash as the same page", () => {
    expect(samePage("file:///show/demo%20one.html", "/show/demo one.html")).toBe(true);
    expect(samePage("https://x.dev/", "https://x.dev")).toBe(true);
    expect(samePage("/show/a.html", "/show/b.html")).toBe(false);
    expect(samePage("/show/%E0%A4%A.html", "/show/%E0%A4%A.html")).toBe(true);
  });
});

describe("shareOnMac", () => {
  it("returns the Share dialog's link", async () => {
    const set = vi.fn().mockResolvedValue(ok("https://weft.zip/@me/threads/x"));
    expect(await shareOnMac("c1", "public", false, { set, nudge: vi.fn(), wait: noWait })).toBe("https://weft.zip/@me/threads/x");
    expect(set).toHaveBeenCalledWith("c1", { mode: "public", showChat: false });
  });

  it("nudges the outbox and waits while the card's row isn't up, then gives up", async () => {
    const set = vi.fn().mockResolvedValueOnce({ kind: "pending" }).mockResolvedValueOnce(ok("u"));
    const nudge = vi.fn();
    expect(await shareOnMac("c1", "public", true, { set, nudge, wait: noWait })).toBe("u");
    expect(nudge).toHaveBeenCalledOnce();
    const never = vi.fn().mockResolvedValue({ kind: "pending" });
    await expect(shareOnMac("c1", "public", true, { set: never, nudge, wait: noWait })).rejects.toThrow(/hasn't reached weft.zip/);
    expect(never).toHaveBeenCalledTimes(PUBLISH_TRIES);
  });

  it("says what the user has to do when sharing can't work yet", async () => {
    const run = (state: CardShareState) => shareOnMac("c", "public", false, { set: vi.fn().mockResolvedValue(state), nudge: vi.fn(), wait: noWait });
    await expect(run({ kind: "signed-out" })).rejects.toThrow(/sign in/);
    await expect(run({ kind: "no-workspace" })).rejects.toThrow(/turn on Sync/);
    await expect(run({ kind: "not-synced", folder: "/p" })).rejects.toThrow(/Sync is off for \/p/);
    await expect(run(ok(null))).rejects.toThrow(/without a link/);
  });

  it("loads card-share and cloud sync only when used", async () => {
    h.setCardShare.mockResolvedValueOnce({ kind: "pending" }).mockResolvedValueOnce(ok("u2"));
    vi.useFakeTimers();
    const out = shareOnMac("c1", "public", false);
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();
    expect(await out).toBe("u2");
    expect(h.syncNow).toHaveBeenCalled();
  });
});

describe("shareOnWorker", () => {
  const card = { id: "c1", title: "Fix the reminder", share: undefined };

  it("asks worker_share_card with the title's slugs and keeps the link on the card", async () => {
    h.cards.set("c1", { ...card });
    const share = vi.fn().mockResolvedValue({ id: "abcdefghijklmnopqrstuv", mode: "public", slug: "fix-the-reminder", show_chat: false, username: "me" });
    expect(await shareOnWorker(card, "public", false, { shareCard: share }, noWait)).toBe("https://weft.zip/@me/threads/fix-the-reminder");
    const args = share.mock.calls[0]?.[0] as { slugs: string[]; shareId: string; mode: string; showChat: boolean };
    expect(args.slugs[0]).toBe("fix-the-reminder");
    expect(args.shareId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(args).toMatchObject({ cardId: "c1", mode: "public", showChat: false });
    expect(h.decorated[0]?.[1]).toMatchObject({ share: { id: "abcdefghijklmnopqrstuv", mode: "public", slug: "fix-the-reminder" } });
  });

  it("reuses the card's share id, and falls back to /s/<id> with no username", async () => {
    const share = vi.fn().mockResolvedValue({ id: "zzzzzzzzzzzzzzzzzzzzzz", mode: "public", slug: null, show_chat: true, username: null });
    const url = await shareOnWorker({ ...card, share: { id: "zzzzzzzzzzzzzzzzzzzzzz", mode: "private", hasPassword: false } }, "public", true, { shareCard: share }, noWait);
    expect(url).toMatch(/\/s\/zzzzzzzzzzzzzzzzzzzzzz$/);
    expect((share.mock.calls[0]?.[0] as { shareId: string }).shareId).toBe("zzzzzzzzzzzzzzzzzzzzzz");
  });

  it("waits for the publisher, then gives up; other errors go straight back", async () => {
    const later = vi.fn().mockRejectedValueOnce(new Error("card not published yet")).mockResolvedValue({ id: "i", mode: "public", slug: null, show_chat: false, username: null });
    expect(await shareOnWorker(card, "public", false, { shareCard: later }, noWait)).toMatch(/\/s\/i$/);
    const never = vi.fn().mockRejectedValue(new Error("card not published yet"));
    await expect(shareOnWorker(card, "public", false, { shareCard: never }, noWait)).rejects.toThrow(/not published/);
    expect(never).toHaveBeenCalledTimes(PUBLISH_TRIES);
    const revoked = vi.fn().mockRejectedValue(new Error("this worker was revoked"));
    await expect(shareOnWorker(card, "public", false, { shareCard: revoked }, noWait)).rejects.toThrow(/revoked/);
    expect(revoked).toHaveBeenCalledOnce();
  });

  it("asks an old worker to update", async () => {
    await expect(shareOnWorker(card, "public", false, {}, noWait)).rejects.toThrow(/restart_weft_when_idle/);
  });

  it("waits with a real timer by default", async () => {
    vi.useFakeTimers();
    const later = vi.fn().mockRejectedValueOnce(new Error("card not published yet")).mockResolvedValue({ id: "i", mode: "public", slug: null, show_chat: false, username: null });
    const out = shareOnWorker(card, "public", false, { shareCard: later });
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();
    expect(await out).toMatch(/\/s\/i$/);
  });
});

describe("shareCard", () => {
  it("needs a card", async () => {
    await expect(shareCard(undefined, {})).rejects.toThrow(/no card/);
    await expect(shareCard("gone", {})).rejects.toThrow(/no card/);
  });

  it("publishes a Mac card pane-only by default, stamps the consent and names the lead page", async () => {
    h.cards.set("c1", { id: "c1", title: "Demo" });
    h.threads.set("c1", [openUrl("/show/demo.html", 1)]);
    h.setCardShare.mockResolvedValue(ok("https://weft.zip/@me/threads/demo"));
    const text = await shareCard("c1", { page: "file:///show/demo.html" });
    expect(text).toContain("Public link: https://weft.zip/@me/threads/demo");
    expect(text).toContain("browser pane only");
    expect(text).toContain("leads with /show/demo.html");
    expect(h.setCardShare).toHaveBeenCalledWith("c1", { mode: "public", showChat: false });
    expect(h.cards.get("c1")?.shareConsent).toBe(true);
  });

  it("shows the chat when asked, and says when the pane has shown nothing", async () => {
    h.cards.set("c1", { id: "c1", title: "Demo", shareConsent: true });
    h.setCardShare.mockResolvedValue(ok("u"));
    const text = await shareCard("c1", { show_chat: true });
    expect(text).toContain("this thread beside its browser pane");
    expect(text).toContain("pane capture");
    expect(h.decorated).toEqual([]);
  });

  it("refuses a lead page the pane doesn't show", async () => {
    h.cards.set("c1", { id: "c1", title: "Demo" });
    await expect(shareCard("c1", { page: "/show/x.html" })).rejects.toThrow(/nothing yet.*Open \/show\/x.html/);
    h.threads.set("c1", [openUrl("/show/y.html", 1)]);
    await expect(shareCard("c1", { page: "/show/x.html" })).rejects.toThrow(/\(\/show\/y.html\)/);
    expect(h.setCardShare).not.toHaveBeenCalled();
    expect(h.cards.get("c1")?.shareConsent).toBeUndefined();
  });

  it("takes a link private without stamping consent", async () => {
    h.cards.set("c1", { id: "c1", title: "Demo" });
    h.setCardShare.mockResolvedValue(ok("u"));
    expect(await shareCard("c1", { public: false })).toMatch(/private now/);
    expect(h.cards.get("c1")?.shareConsent).toBeUndefined();
  });

  it("goes through worker_share_card on a worker", async () => {
    h.worker = true;
    h.cards.set("c1", { id: "c1", title: "Demo" });
    h.shareCard = vi.fn().mockResolvedValue({ id: "i", mode: "public", slug: "demo", show_chat: false, username: "me" });
    expect(await shareCard("c1", {})).toContain("https://weft.zip/@me/threads/demo");
    expect(h.setCardShare).not.toHaveBeenCalled();
  });
});

describe("shareTool", () => {
  const run = async (args: Record<string, unknown>, cardId = "c1") => {
    const t = shareTool(() => cardId);
    return (await t.handler(args as never, {})) as { content: { text: string }[]; isError?: boolean };
  };

  it("is named share_card and answers with the link", async () => {
    expect(shareTool(() => undefined).name).toBe("share_card");
    h.cards.set("c1", { id: "c1", title: "Demo" });
    h.setCardShare.mockResolvedValue(ok("https://weft.zip/s/abc"));
    const out = await run({});
    expect(out.isError).toBeUndefined();
    expect(out.content[0]?.text).toContain("https://weft.zip/s/abc");
  });

  it("answers a failure as an error result", async () => {
    const out = await run({}, "missing");
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toMatch(/no card/);
    h.cards.set("c1", { id: "c1", title: "Demo" });
    h.setCardShare.mockRejectedValue("boom");
    expect((await run({})).content[0]?.text).toBe("boom");
  });
});
