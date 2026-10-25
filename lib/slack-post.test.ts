import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Posting to Slack from the server: main holds the bot token and makes the call, so the server only sends the
// message and gets back where it landed.

const main = vi.hoisted(() => ({ shell: vi.fn<(route: string, body?: Record<string, unknown>) => Promise<Record<string, unknown>>>() }));
vi.mock("./browser-tools", () => main);

const post = await import("./slack-post");

const message = { text: "hello", blocks: [] };

beforeEach(() => {
  vi.clearAllMocks();
  main.shell.mockResolvedValue({ channel: "C9", ts: "9.9" });
});
afterEach(() => vi.restoreAllMocks());

describe("postToSlack", () => {
  it("posts to main and returns where the message landed", async () => {
    const thread = await post.postToSlack("C1", message);
    expect(main.shell).toHaveBeenCalledWith("/slack/post", { channel: "C1", text: "hello", blocks: [] });
    expect(thread).toEqual({ channel: "C9", ts: "9.9" });
  });

  it("replies under a thread when it has one", async () => {
    await post.postToSlack("C1", message, "1.0");
    expect(main.shell).toHaveBeenCalledWith("/slack/post", { channel: "C1", text: "hello", blocks: [], thread_ts: "1.0" });
  });

  it("keeps the channel it was given when main answers without one", async () => {
    main.shell.mockResolvedValue({ ts: "9.9" });
    expect(await post.postToSlack("C1", message)).toEqual({ channel: "C1", ts: "9.9" });
  });

  it("has no timestamp when main answers without one", async () => {
    main.shell.mockResolvedValue({ channel: "C1" });
    expect(await post.postToSlack("C1", message)).toEqual({ channel: "C1", ts: "" });
  });
});

describe("sendToSlack", () => {
  it("posts without waiting for the answer", () => {
    post.sendToSlack("C1", message);
    expect(main.shell).toHaveBeenCalled();
  });

  it("says so when Slack is down, and keeps going", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    main.shell.mockRejectedValue(new Error("slack is down"));
    post.sendToSlack("C1", message);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("[weft] slack: slack is down"));
  });

  it("says so when the failure isn't an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    main.shell.mockRejectedValue("offline");
    post.sendToSlack("C1", message);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("[weft] slack: offline"));
  });
});
