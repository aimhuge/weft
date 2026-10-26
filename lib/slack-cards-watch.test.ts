import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The card watcher: a card that lands in Needs you, Review or Done posts once it has held still for SETTLE_MS.
// The board's bus, its cards, the Slack settings and the posting are fakes (lib/slack-cards.harness.ts).

const fake = await vi.hoisted(async () => (await import("./slack-cards.harness")).fakeCards());

vi.mock("./bus", () => ({
  subscribe: (listener: (event: { type: string; card: { id: string; column: string } }) => void) => {
    fake.state.listener = listener;
    return fake.state.unsubscribe;
  },
}));

vi.mock("./store", () => ({
  getCard: (id: string) => fake.state.cards.find((c) => c.id === id),
  getThread: (id: string) => fake.state.threads[id] ?? [],
  listCards: () => fake.state.cards,
}));

vi.mock("./slack-store", () => ({
  cardThread: (id: string) => fake.state.known[id] ?? null,
  saveCardThread: vi.fn(),
  slackSettings: () => fake.state.settings,
}));

vi.mock("./slack-link", () => ({ cardLink: () => Promise.resolve(fake.state.link) }));

vi.mock("./slack-post", () => ({
  postToSlack: (channel: string, message: { text: string; blocks: unknown[] }, threadTs?: string) => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is the branch under test
    if (fake.posted.fail) return Promise.reject(fake.posted.fail);
    fake.posted.calls.push({ channel, ...message, thread_ts: threadTs });
    return Promise.resolve({ channel: "C1", ts: fake.posted.ts });
  },
}));

const cards = await import("./slack-cards");

const card = (id: string, column: string) => ({ id, title: `Card ${id}`, cwd: "/dev/app", column });
const emit = (id: string, column: string) => fake.state.listener?.({ type: "card", card: { id, column } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fake.posted.calls.length = 0;
  fake.posted.ts = "root-1";
  fake.posted.fail = false;
  fake.state.listener = null;
  fake.state.unsubscribe = vi.fn();
  fake.state.cards = [];
  fake.state.threads = {};
  fake.state.known = {};
  fake.state.link = null;
  fake.state.settings = fake.freshSettings();
});
afterEach(() => vi.useRealTimers());

describe("watchCardStatus", () => {
  it("posts a card's move to Review once it has held still", async () => {
    fake.state.cards = [card("a", "running")];
    const stop = cards.watchCardStatus();
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS - 1);
    expect(fake.posted.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.posted.calls).toHaveLength(2);
    expect(JSON.stringify(fake.posted.calls[1]?.blocks)).toContain("👀 Ready for review");
    stop();
  });

  it("posts once when the card moves twice in a second", async () => {
    fake.state.cards = [card("a", "running")];
    const stop = cards.watchCardStatus();
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    fake.state.cards = [card("a", "done")];
    emit("a", "done");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(2);
    expect(JSON.stringify(fake.posted.calls[1]?.blocks)).toContain("✅ Done");
    stop();
  });

  it("says nothing for a card that isn't on the board or didn't move", async () => {
    fake.state.cards = [card("a", "running")];
    const stop = cards.watchCardStatus();
    emit("b", "review");
    emit("a", "running");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(0);
    stop();
  });

  it("says nothing for a card that appears for the first time", async () => {
    const stop = cards.watchCardStatus();
    fake.state.cards = [card("new", "review")];
    emit("new", "review");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(0);
    stop();
  });

  it("says nothing for a card that goes back to Running, and posts the next landing", async () => {
    fake.state.cards = [card("a", "running")];
    const stop = cards.watchCardStatus();
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    fake.state.cards = [card("a", "running")];
    emit("a", "running");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(0);

    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(2);
    stop();
  });

  it("ignores the copilot and anything that isn't a card", async () => {
    const stop = cards.watchCardStatus();
    fake.state.listener?.({ type: "thread", card: { id: "a", column: "review" } });
    fake.state.listener?.({ type: "card", card: { id: "copilot", column: "review" } });
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(0);
    stop();
  });

  it("posts the card again when it lands a second time", async () => {
    fake.state.cards = [card("a", "running")];
    const stop = cards.watchCardStatus();
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    fake.state.cards = [card("a", "running")];
    emit("a", "running");
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(4);
    stop();
  });

  it("stops listening and drops its pending posts", async () => {
    fake.state.cards = [card("a", "running")];
    const stop = cards.watchCardStatus();
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    stop();
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(0);
    expect(fake.state.unsubscribe).toHaveBeenCalled();
  });

  it("says nothing when the card is gone by the time it settles", async () => {
    fake.state.cards = [card("a", "running")];
    const stop = cards.watchCardStatus();
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    fake.state.cards = [];
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(0);
    stop();
  });

  it("says nothing when the card is still in the column it was in", async () => {
    fake.state.cards = [card("a", "running")];
    const stop = cards.watchCardStatus();
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(2);
    // The card moved back to Running and landed in Review again, but the watcher saw Review before.
    fake.state.cards = [card("a", "running")];
    emit("a", "running");
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(fake.posted.calls).toHaveLength(4);
    stop();
  });

  it("says so when the post fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.state.cards = [card("a", "running")];
    const stop = cards.watchCardStatus();
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    fake.posted.fail = new Error("slack is down");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(warn).toHaveBeenCalledWith("[weft] slack: slack is down");
    // Not counted as posted: the next landing in the same column tries again once Slack is back.
    fake.posted.fail = false;
    fake.state.cards = [card("a", "needs_you")];
    emit("a", "needs_you");
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(JSON.stringify(fake.posted.calls.at(-1)?.blocks)).toContain("👀 Ready for review");
    stop();
  });

  it("says so when the failure isn't an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.state.cards = [card("a", "running")];
    const stop = cards.watchCardStatus();
    fake.state.cards = [card("a", "review")];
    emit("a", "review");
    fake.posted.fail = "offline";
    await vi.advanceTimersByTimeAsync(cards.SETTLE_MS);
    expect(warn).toHaveBeenCalledWith("[weft] slack: offline");
    stop();
  });
});
