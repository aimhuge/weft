import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Weft in Slack, the server's half: it watches the board's repos, Vercel and the board's cards, and posts each to
// the drawer's channel. The watchers, the board's cards and the posting are fakes.

interface FakeSettings {
  channel: string | null;
  channelName: string;
  folder: string | null;
  links: { folder: string; channel: string; channelName: string | null }[];
  events: { commits: boolean; pushes: boolean; deploys: boolean; status: boolean };
}

interface FakeState {
  gitEvents: { onCommits: (cwd: string, branch: string, commits: { sha: string; subject: string }[]) => void; onPush: (cwd: string, ref: string, count: number) => void } | null;
  gitTick: ReturnType<typeof vi.fn<(folders: string[]) => Promise<void>>>;
  deployTick: ReturnType<typeof vi.fn<(folders: string[]) => Promise<void>>>;
  deployPost: ((message: { text: string }, folder: string) => void) | null;
  cardStop: ReturnType<typeof vi.fn>;
  cards: { id: string; cwd: string }[];
  settings: FakeSettings;
}

const fake = vi.hoisted((): FakeState => ({
  gitEvents: null,
  gitTick: vi.fn<(folders: string[]) => Promise<void>>(),
  deployTick: vi.fn<(folders: string[]) => Promise<void>>(),
  deployPost: null,
  cardStop: vi.fn(),
  cards: [],
  settings: { channel: "C1", channelName: "general", folder: null, links: [], events: { commits: true, pushes: true, deploys: true, status: true } },
}));

vi.mock("./slack-git", () => ({
  createGitWatch: (events: typeof fake.gitEvents) => {
    fake.gitEvents = events;
    return { tick: fake.gitTick };
  },
}));

vi.mock("./slack-deploys", () => ({
  createDeployWatch: (post: (message: { text: string }, folder: string) => void) => {
    fake.deployPost = post;
    return { tick: fake.deployTick };
  },
}));
vi.mock("./slack-cards", () => ({ watchCardStatus: () => fake.cardStop }));

const sent = vi.hoisted(() => ({ calls: [] as { channel: string; message: { text: string }; threadTs?: string }[] }));
vi.mock("./slack-post", () => ({
  sendToSlack: (channel: string, message: { text: string }, threadTs?: string) => sent.calls.push({ channel, message, threadTs }),
}));

vi.mock("./slack-store", () => ({ slackSettings: () => fake.settings }));
vi.mock("./store", () => ({ listCards: () => fake.cards }));

const slack = await import("./slack");

const g = globalThis as unknown as { __weftSlack?: unknown };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  delete g.__weftSlack;
  sent.calls.length = 0;
  fake.gitEvents = null;
  fake.gitTick.mockResolvedValue(undefined);
  fake.deployTick.mockResolvedValue(undefined);
  fake.deployPost = null;
  fake.cards = [];
  fake.settings = { channel: "C1", channelName: "general", folder: null, links: [], events: { commits: true, pushes: true, deploys: true, status: true } };
});
afterEach(() => {
  slack.stopSlack();
  vi.useRealTimers();
});

describe("boardFolders", () => {
  it("is empty without cards and without a folder", () => {
    expect(slack.boardFolders()).toEqual([]);
  });

  it("lists each card's folder once, without the copilot", () => {
    fake.cards = [{ id: "a", cwd: "/dev/app" }, { id: "b", cwd: "/dev/app" }, { id: "copilot", cwd: "/dev/copilot" }];
    expect(slack.boardFolders()).toEqual(["/dev/app"]);
  });

  it("adds the folder Slack cards start in", () => {
    fake.settings.folder = "/dev/other";
    expect(slack.boardFolders()).toEqual(["/dev/other"]);
  });

  it("adds the folders mapped to a channel", () => {
    fake.settings.links = [{ folder: "/dev/mapped", channel: "C7", channelName: "mapped" }];
    expect(slack.boardFolders()).toEqual(["/dev/mapped"]);
  });

  it("adds the mapped folders beside the cards' and the default one", () => {
    fake.cards = [{ id: "a", cwd: "/dev/app" }];
    fake.settings.folder = "/dev/other";
    fake.settings.links = [{ folder: "/dev/mapped", channel: "C7", channelName: "mapped" }];
    expect(slack.boardFolders()).toEqual(["/dev/app", "/dev/other", "/dev/mapped"]);
  });
});

describe("startSlack", () => {
  it("watches the repos at once and then every few seconds", async () => {
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.gitTick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(slack.GIT_MS);
    expect(fake.gitTick).toHaveBeenCalledTimes(2);
  });

  it("posts the commits and pushes it is told about", async () => {
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    fake.gitEvents?.onCommits("/dev/app", "main", [{ sha: "abcdef1234", subject: "fix login" }]);
    fake.gitEvents?.onPush("/dev/app", "origin/main", 2);
    expect(sent.calls).toHaveLength(2);
    expect(sent.calls[0]?.message.text).toBe("app: fix login");
    expect(sent.calls[1]?.message.text).toBe("app: pushed 2 commits to origin/main");
    expect(sent.calls[0]?.channel).toBe("C1");
  });

  it("posts nothing when there is no channel", async () => {
    fake.settings.channel = null;
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    fake.gitEvents?.onCommits("/dev/app", "main", [{ sha: "abcdef1234", subject: "fix login" }]);
    expect(sent.calls).toHaveLength(0);
  });

  it("posts a commit in a mapped project to that project's channel", async () => {
    fake.settings.links = [{ folder: "/dev/app", channel: "C7", channelName: "app" }];
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    fake.gitEvents?.onCommits("/dev/app", "main", [{ sha: "abcdef1234", subject: "fix login" }]);
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]?.channel).toBe("C7");
  });

  it("posts a commit in an unmapped project to the default channel", async () => {
    fake.settings.links = [{ folder: "/dev/other", channel: "C7", channelName: "other" }];
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    fake.gitEvents?.onCommits("/dev/app", "main", [{ sha: "abcdef1234", subject: "fix login" }]);
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]?.channel).toBe("C1");
  });

  it("posts a deploy to the channel of the folder it was deployed from", async () => {
    fake.settings.links = [{ folder: "/dev/app", channel: "C7", channelName: "app" }];
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    fake.deployPost?.({ text: "deployed" }, "/dev/app");
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]?.channel).toBe("C7");
  });

  it("posts a deploy of an unmapped folder to the default channel", async () => {
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    fake.deployPost?.({ text: "deployed" }, "/dev/other");
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]?.channel).toBe("C1");
  });

  it("posts nothing for an update that is switched off", async () => {
    fake.settings.events.commits = false;
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    fake.gitEvents?.onCommits("/dev/app", "main", [{ sha: "abcdef1234", subject: "fix login" }]);
    fake.gitEvents?.onPush("/dev/app", "origin/main", 1);
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]?.message.text).toContain("pushed");
  });

  it("asks Vercel only when deploys would be posted", async () => {
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(slack.DEPLOY_MS);
    expect(fake.deployTick).toHaveBeenCalledTimes(1);

    slack.stopSlack();
    delete g.__weftSlack;
    fake.deployTick.mockClear();
    fake.settings.events.deploys = false;
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(slack.DEPLOY_MS);
    expect(fake.deployTick).not.toHaveBeenCalled();
  });

  it("asks Vercel for nothing when there is no channel", async () => {
    fake.settings.channel = null;
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(slack.DEPLOY_MS);
    expect(fake.deployTick).not.toHaveBeenCalled();
  });

  it("asks Vercel when only a mapped channel is set", async () => {
    fake.settings.channel = null;
    fake.settings.links = [{ folder: "/dev/app", channel: "C7", channelName: "app" }];
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(slack.DEPLOY_MS);
    expect(fake.deployTick).toHaveBeenCalledTimes(1);
  });

  it("starts only once", async () => {
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.gitTick).toHaveBeenCalledTimes(1);
  });

  it("skips a look while the last one is still running", async () => {
    let release = () => {};
    fake.gitTick.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(slack.GIT_MS);
    expect(fake.gitTick).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(slack.GIT_MS);
    expect(fake.gitTick).toHaveBeenCalledTimes(2);
  });

  it("says so when a look fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.gitTick.mockRejectedValue(new Error("no repo"));
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith("[weft] slack: no repo");
  });

  it("says so when a look fails with something that isn't an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.gitTick.mockRejectedValue("offline");
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith("[weft] slack: offline");
  });

  it("says so when the deploy look fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.deployTick.mockRejectedValue(new Error("vercel is down"));
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(slack.DEPLOY_MS);
    expect(warn).toHaveBeenCalledWith("[weft] slack: vercel is down");
  });
});

describe("stopSlack", () => {
  it("stops the timers and the card watcher", async () => {
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    slack.stopSlack();
    expect(fake.cardStop).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(slack.GIT_MS * 2);
    expect(fake.gitTick).toHaveBeenCalledTimes(1);
    expect(fake.deployTick).not.toHaveBeenCalled();
  });

  it("can start again after it stopped", async () => {
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    slack.stopSlack();
    slack.startSlack();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.gitTick).toHaveBeenCalledTimes(2);
  });
});
