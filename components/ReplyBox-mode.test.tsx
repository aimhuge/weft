// @vitest-environment jsdom
// The reply box's primary picks the right default (lib/reply-mode.ts): a fresh session when the cache is cold, a send at
// the reset when the 5-hour window is used up, and the mode chip that says so.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import ReplyBox from "./ReplyBox";

const api = vi.hoisted(() => ({
  schedule: vi.fn(() => Promise.resolve()),
  unschedule: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/client", () => ({ api }));
vi.mock("./Composer", () => import("./composer-mock"));

type Props = Parameters<typeof ReplyBox>[0];

// A cache that went cold an hour ago.
const coldCache = { tokens: 184_100, at: Date.now() - 3600_000, ttl: 300, hit: 0 };

function setup(props: Partial<Props> = {}) {
  const onSend = vi.fn<Props["onSend"]>(() => Promise.resolve());
  const onStop = vi.fn<Props["onStop"]>(() => Promise.resolve());
  render(<ReplyBox cardId="c1" cwd="/repo" live={false} placeholder="Reply…" onSend={onSend} onStop={onStop} {...props} />);
  return { onSend, box: screen.getByRole("textbox", { name: "Message" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(cleanup);

describe("cold cache", () => {
  it("sends fresh on Enter: the box's text goes to a new session and the box clears", async () => {
    const onFresh = vi.fn(() => Promise.resolve());
    const { onSend, box } = setup({ stale: { cache: coldCache, onFresh } });
    expect(screen.getByText(/^Cache cold · /)).toBeInTheDocument();
    await userEvent.type(box, "and the header{Enter}");
    expect(onFresh).toHaveBeenCalledWith("and the header");
    expect(onSend).not.toHaveBeenCalled();
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("won't send fresh from an empty box, shows a failure, and still sends with the full history from the menu", async () => {
    const onFresh = vi.fn(() => Promise.reject(new Error("no summary")));
    const { onSend, box } = setup({ stale: { cache: coldCache, onFresh } });
    await userEvent.type(box, "{Enter}");
    expect(onFresh).not.toHaveBeenCalled();
    expect(screen.getByText("Write a message first.")).toBeInTheDocument();
    await userEvent.type(box, "go on{Enter}");
    expect(await screen.findByText("no summary")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More ways to send" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /full history/ }));
    expect(onSend).toHaveBeenCalledWith("go on");
  });
});

describe("Done button", () => {
  it("sends /weft:done in the thread while the cache is warm", async () => {
    const { onSend } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSend).toHaveBeenCalledWith("/weft:done");
  });

  it("sends /weft:done fresh when the cache is cold, leaving the draft alone", async () => {
    const onFresh = vi.fn(() => Promise.resolve());
    const { onSend, box } = setup({ stale: { cache: coldCache, onFresh } });
    await userEvent.type(box, "draft");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onFresh).toHaveBeenCalledWith("/weft:done");
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("draft");
  });
});

describe("5-hour window used up", () => {
  it("schedules for the reset instead of sending", async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const { onSend, box } = setup({ fiveHour: { used: 100, resetsAt: reset }, sendLater: { backend: "claude", resets: {}, scheduled: [] } });
    expect(screen.getByText("5-hour limit used up")).toBeInTheDocument();
    await userEvent.type(box, "after the reset");
    await userEvent.click(screen.getByRole("button", { name: /^Send at / }));
    expect(api.schedule).toHaveBeenCalledWith("c1", "after the reset", reset * 1000);
    expect(onSend).not.toHaveBeenCalled();
    await waitFor(() => expect(box).toHaveValue(""));
  });
});

describe("mid-turn", () => {
  it("Enter sends at once on a turn that takes it in, without stopping it; Queue waits for the turn", async () => {
    const onStop = vi.fn<Props["onStop"]>(() => Promise.resolve());
    const { onSend, box } = setup({ live: true, midTurn: true, onStop });
    expect(screen.getByText("After the next tool call")).toBeInTheDocument();
    await userEvent.type(box, "skip the e2e tests{Enter}");
    expect(onSend).toHaveBeenCalledWith("skip the e2e tests");
    expect(onStop).not.toHaveBeenCalled();
    await waitFor(() => expect(box).toHaveValue(""));
    await userEvent.type(box, "after");
    await userEvent.click(screen.getByRole("button", { name: "More ways to send" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Queue · after this turn/ }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe("mode chip", () => {
  it("names the queue while a turn runs, and nothing on a plain reply", () => {
    setup({ live: true });
    expect(screen.getByText("Queue · after this turn")).toBeInTheDocument();
    cleanup();
    setup();
    expect(screen.queryByText(/Queue/)).not.toBeInTheDocument();
  });
});
