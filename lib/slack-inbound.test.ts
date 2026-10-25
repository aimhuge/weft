import { beforeEach, describe, expect, it, vi } from "vitest";

// Slack talking to Weft: `/weft <prompt>` or an @mention starts a card; an @mention inside a card's thread is a
// message to that card. The board's cards, the new-card helpers, the runner and the posting are fakes.

interface FakeSettings {
  channel: string | null;
  channelName: string;
  folder: string | null;
  links: { folder: string; channel: string; channelName: string | null }[];
  events: { commits: boolean; pushes: boolean; deploys: boolean; status: boolean };
}

interface FakeState {
  card: { id: string; title: string; cwd: string };
  settings: FakeSettings;
  threads: Record<string, { channel: string; ts: string }>;
  cards: { id: string }[];
  link: string | null;
}

const fake = vi.hoisted((): FakeState => ({
  card: { id: "card-1", title: "Fix login", cwd: "/dev/app" },
  settings: { channel: "C1", channelName: "general", folder: "/dev/app", links: [], events: { commits: true, pushes: true, deploys: true, status: true } },
  threads: {},
  cards: [],
  link: null,
}));

vi.mock("./new-card", () => ({
  createCardFromBody: vi.fn((body: Record<string, unknown>) => ({ ...fake.card, prompt: body.prompt, cwd: body.cwd })),
  startCard: vi.fn(),
}));

vi.mock("./runner", () => ({ sendMessage: vi.fn() }));

vi.mock("./slack-link", () => ({ cardLink: () => Promise.resolve(fake.link) }));

vi.mock("./slack-store", () => ({
  cardOfThread: (channel: string, ts: string) => {
    const hit = Object.entries(fake.threads).find(([, t]) => t.channel === channel && t.ts === ts);
    return hit?.[0] ?? null;
  },
  saveCardThread: vi.fn(),
  slackSettings: () => fake.settings,
}));

vi.mock("./store", () => ({ getCard: (id: string) => fake.cards.find((c) => c.id === id) }));

const posted = vi.hoisted(() => ({
  calls: [] as { channel: string; text: string; blocks: unknown[]; thread_ts?: string }[],
  ts: "posted-1",
}));
vi.mock("./slack-post", () => ({
  postToSlack: (channel: string, message: { text: string; blocks: unknown[] }, threadTs?: string) => {
    posted.calls.push({ channel, ...message, thread_ts: threadTs });
    return Promise.resolve({ channel: "C1", ts: posted.ts });
  },
}));

const inbound = await import("./slack-inbound");
const newCard = await import("./new-card");
const runner = await import("./runner");
const slackStore = await import("./slack-store");

const mention = (text: string, over: Partial<Parameters<typeof inbound.handleInbound>[0]> = {}) => ({
  kind: "mention" as const,
  text,
  channel: "C1",
  user: "U1",
  ts: "1.0",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  posted.calls.length = 0;
  posted.ts = "posted-1";
  fake.card = { id: "card-1", title: "Fix login", cwd: "/dev/app" };
  fake.settings = { channel: "C1", channelName: "general", folder: "/dev/app", links: [], events: { commits: true, pushes: true, deploys: true, status: true } };
  fake.threads = {};
  fake.cards = [];
  fake.link = null;
});

describe("handleInbound", () => {
  it("starts a card for a slash command", async () => {
    const result = await inbound.handleInbound({ kind: "command", text: "/weft fix the login bug", channel: "C1", user: "U1" });
    expect(result).toEqual({ kind: "started", cardId: "card-1" });
    expect(newCard.createCardFromBody).toHaveBeenCalledWith({ prompt: "/weft fix the login bug", cwd: "/dev/app", tags: ["slack"] });
    expect(newCard.startCard).toHaveBeenCalled();
    expect(posted.calls).toHaveLength(1);
  });

  it("saves the card's thread before it starts the card", async () => {
    await inbound.handleInbound({ kind: "command", text: "fix it", channel: "C1", user: "U1" });
    const saved = vi.mocked(slackStore.saveCardThread).mock.invocationCallOrder[0] ?? Infinity;
    const started = vi.mocked(newCard.startCard).mock.invocationCallOrder[0] ?? -1;
    expect(saved).toBeLessThan(started);
  });

  it("starts a card for a mention, under the mention", async () => {
    const result = await inbound.handleInbound(mention("fix the login bug"));
    expect(result).toEqual({ kind: "started", cardId: "card-1" });
    expect(posted.calls[0]?.thread_ts).toBe("1.0");
    expect(slackStore.saveCardThread).toHaveBeenCalledWith("card-1", { channel: "C1", ts: "1.0" });
  });

  it("starts a card under the thread a mention was in", async () => {
    await inbound.handleInbound(mention("fix it", { threadTs: "9.9" }));
    expect(posted.calls[0]?.thread_ts).toBe("9.9");
    expect(slackStore.saveCardThread).toHaveBeenCalledWith("card-1", { channel: "C1", ts: "9.9" });
  });

  it("leaves a slash command's card thread on the message it posted", async () => {
    await inbound.handleInbound({ kind: "command", text: "/weft fix it", channel: "C1", user: "U1" });
    expect(posted.calls[0]?.thread_ts).toBeUndefined();
    expect(slackStore.saveCardThread).toHaveBeenCalledWith("card-1", { channel: "C1", ts: "posted-1" });
  });

  it("says how to use it when there is nothing to do", async () => {
    const result = await inbound.handleInbound({ kind: "command", text: "  ", channel: "C1", user: "U1" });
    expect(result.kind).toBe("refused");
    expect(posted.calls[0]?.text).toContain("Tell Weft what to build");
  });

  it("asks for a project when none is picked", async () => {
    fake.settings.folder = null;
    const result = await inbound.handleInbound({ kind: "command", text: "/weft fix it", channel: "C1", user: "U1" });
    expect(result.kind).toBe("refused");
    expect((result as { reason: string }).reason).toContain("pick a default one");
    expect(newCard.createCardFromBody).not.toHaveBeenCalled();
  });

  it("starts the card in the project mapped to the channel it came from", async () => {
    fake.settings.links = [{ folder: "/dev/mapped", channel: "C7", channelName: "mapped" }];
    await inbound.handleInbound({ kind: "command", text: "/weft fix it", channel: "C7", user: "U1" });
    expect(newCard.createCardFromBody).toHaveBeenCalledWith({ prompt: "/weft fix it", cwd: "/dev/mapped", tags: ["slack"] });
  });

  it("starts the card in the default project when the channel has none of its own", async () => {
    fake.settings.links = [{ folder: "/dev/mapped", channel: "C7", channelName: "mapped" }];
    await inbound.handleInbound({ kind: "command", text: "/weft fix it", channel: "C1", user: "U1" });
    expect(newCard.createCardFromBody).toHaveBeenCalledWith({ prompt: "/weft fix it", cwd: "/dev/app", tags: ["slack"] });
  });

  it("says so when neither a mapped nor a default project is picked", async () => {
    fake.settings.folder = null;
    fake.settings.links = [];
    const result = await inbound.handleInbound({ kind: "command", text: "/weft fix it", channel: "C1", user: "U1" });
    expect(result.kind).toBe("refused");
    expect((result as { reason: string }).reason).toContain("Map this channel to a project");
    expect(newCard.createCardFromBody).not.toHaveBeenCalled();
  });

  it("links the card it started when its folder syncs", async () => {
    fake.link = "https://weft.zip/acme/board?card=card-1";
    await inbound.handleInbound({ kind: "command", text: "/weft fix it", channel: "C1", user: "U1" });
    expect(JSON.stringify(posted.calls[0]?.blocks)).toContain("weft.zip");
  });

  it("saves no thread when the message it posted has no timestamp", async () => {
    posted.ts = "";
    await inbound.handleInbound({ kind: "command", text: "/weft fix it", channel: "C1", user: "U1" });
    expect(slackStore.saveCardThread).not.toHaveBeenCalled();
  });

  it("sends a mention in a card's thread to that card", async () => {
    fake.threads["card-9"] = { channel: "C1", ts: "9.9" };
    fake.cards = [{ id: "card-9" }];
    const result = await inbound.handleInbound(mention("keep going", { threadTs: "9.9" }));
    expect(result).toEqual({ kind: "sent", cardId: "card-9" });
    expect(runner.sendMessage).toHaveBeenCalledWith("card-9", "keep going");
    expect(posted.calls[0]?.thread_ts).toBe("9.9");
    expect(posted.calls[0]?.text).toContain("Sent to the card");
  });

  it("says the card is gone when it is no longer on the board", async () => {
    fake.threads["card-9"] = { channel: "C1", ts: "9.9" };
    const result = await inbound.handleInbound(mention("keep going", { threadTs: "9.9" }));
    expect(result.kind).toBe("refused");
    expect((result as { reason: string }).reason).toContain("isn't on the board");
  });

  it("asks what the card should do next when the mention says nothing", async () => {
    fake.threads["card-9"] = { channel: "C1", ts: "9.9" };
    fake.cards = [{ id: "card-9" }];
    const result = await inbound.handleInbound(mention("  ", { threadTs: "9.9" }));
    expect(result.kind).toBe("refused");
    expect((result as { reason: string }).reason).toContain("Say what the card should do next");
    expect(runner.sendMessage).not.toHaveBeenCalled();
  });

  it("starts a card when the thread belongs to no card", async () => {
    const result = await inbound.handleInbound(mention("fix it", { threadTs: "9.9" }));
    expect(result).toEqual({ kind: "started", cardId: "card-1" });
  });
});
