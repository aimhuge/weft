import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Card status in Slack: a card landing in Needs you, Review or Done gets a reply in its Slack thread. The board's
// bus, its cards, the Slack settings and the posting are fakes (lib/slack-cards.harness.ts).

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
  fake.state.settings = { channel: "C1", channelName: "general", folder: null, links: [], events: { commits: true, pushes: true, deploys: true, status: true } };
});
afterEach(() => vi.useRealTimers());

describe("postCardStatus", () => {
  it("has nothing to post for a card that isn't on the board", async () => {
    expect(await cards.postCardStatus("nope")).toBe(false);
  });

  it("has nothing to post for a card in Running or Backlog", async () => {
    fake.state.cards = [card("a", "running"), card("b", "backlog")];
    expect(await cards.postCardStatus("a")).toBe(false);
    expect(await cards.postCardStatus("b")).toBe(false);
  });

  it("posts nothing for a card with no thread while card status is off", async () => {
    fake.state.cards = [card("a", "review")];
    fake.state.settings.events.status = false;
    expect(await cards.postCardStatus("a")).toBe(false);
    expect(fake.posted.calls).toHaveLength(0);
  });

  it("posts nothing for a card with no thread and no channel", async () => {
    fake.state.cards = [card("a", "review")];
    fake.state.settings.channel = null;
    expect(await cards.postCardStatus("a")).toBe(false);
    expect(fake.posted.calls).toHaveLength(0);
  });

  it("starts a thread for a card that has none, then replies under it", async () => {
    fake.state.cards = [card("a", "review")];
    fake.state.threads.a = [{ kind: "assistant", text: "all done" }];
    expect(await cards.postCardStatus("a")).toBe(true);
    expect(fake.posted.calls).toHaveLength(2);
    expect(fake.posted.calls[0]?.thread_ts).toBeUndefined();
    expect(fake.posted.calls[1]?.thread_ts).toBe("root-1");
    expect(JSON.stringify(fake.posted.calls[1]?.blocks)).toContain("all done");
  });

  it("saves the thread it started", async () => {
    const store = await import("./slack-store");
    fake.state.cards = [card("a", "review")];
    await cards.postCardStatus("a");
    expect(store.saveCardThread).toHaveBeenCalledWith("a", { channel: "C1", ts: "root-1" });
  });

  it("starts a card in a mapped project in that project's channel", async () => {
    fake.state.cards = [card("a", "review")];
    fake.state.settings.links = [{ folder: "/dev/app", channel: "C7", channelName: "app" }];
    expect(await cards.postCardStatus("a")).toBe(true);
    expect(fake.posted.calls[0]?.channel).toBe("C7");
  });

  it("replies under the thread the card already has", async () => {
    fake.state.cards = [card("a", "review")];
    fake.state.known.a = { channel: "C7", ts: "7.7" };
    expect(await cards.postCardStatus("a")).toBe(true);
    expect(fake.posted.calls).toHaveLength(1);
    expect(fake.posted.calls[0]?.channel).toBe("C7");
    expect(fake.posted.calls[0]?.thread_ts).toBe("7.7");
  });

  it("previews the last assistant reply", async () => {
    fake.state.cards = [card("a", "review")];
    fake.state.known.a = { channel: "C7", ts: "7.7" };
    fake.state.threads.a = [
      { kind: "assistant", text: "first" },
      { kind: "user", text: "thanks" },
      { kind: "assistant", text: "last one" },
    ];
    await cards.postCardStatus("a");
    expect(JSON.stringify(fake.posted.calls[0]?.blocks)).toContain("last one");
    expect(JSON.stringify(fake.posted.calls[0]?.blocks)).not.toContain("first");
  });

  it("previews nothing when there is no assistant reply", async () => {
    fake.state.cards = [card("a", "review")];
    fake.state.known.a = { channel: "C7", ts: "7.7" };
    fake.state.threads.a = [{ kind: "user", text: "hello" }, { kind: "assistant", text: "   " }];
    await cards.postCardStatus("a");
    expect(fake.posted.calls).toHaveLength(1);
    expect(fake.posted.calls[0]?.blocks).toHaveLength(1);
  });

  it("carries the card's link when its folder syncs", async () => {
    fake.state.cards = [card("a", "review")];
    fake.state.known.a = { channel: "C7", ts: "7.7" };
    fake.state.link = "https://weft.zip/acme/board?card=a";
    await cards.postCardStatus("a");
    expect(JSON.stringify(fake.posted.calls[0]?.blocks)).toContain("weft.zip");
  });

  it("posts nothing when the message it started has no timestamp", async () => {
    fake.state.cards = [card("a", "review")];
    fake.posted.ts = "";
    expect(await cards.postCardStatus("a")).toBe(false);
    expect(fake.posted.calls).toHaveLength(1);
  });
});
