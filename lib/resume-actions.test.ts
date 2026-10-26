import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSED_LINE } from "./card-resume";
import type { Card } from "./types";

const api = vi.hoisted(() => ({ send: vi.fn(() => Promise.resolve()), restart: vi.fn(() => Promise.resolve()) }));
vi.mock("./client", () => ({ api }));
const { resumeActions } = await import("./resume-actions");
const { applyIntents, forget } = await import("./optimistic-cards");

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, title: id, prompt: "p", cwd: "/x", backend: "claude", permissionMode: "default",
  column: "review", lastLine: CLOSED_LINE, sessionId: "s", createdAt: 0, updatedAt: 0, ...over,
});

// The resume goes through patchNow, whose settle timer waits ten seconds: fake timers keep it out of the run.
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  forget("a");
  forget("b");
});

describe("resumeActions", () => {
  it("resume sends continue, or restarts, and hands a failure to notify", async () => {
    const notify = vi.fn();
    const { resume } = resumeActions([], notify);
    resume("a", "continue");
    expect(api.send).toHaveBeenCalledWith("a", "continue");
    api.restart.mockRejectedValueOnce(new Error("no message"));
    resume("b", "restart");
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("no message")));
  });

  it("moves the card to Running at once, before the server answers", () => {
    const { resume } = resumeActions([], vi.fn());
    resume("a", "continue");
    expect(applyIntents([card("a")])[0]?.column).toBe("running");
  });

  it("all runs each cut-off Review card, and is missing when there are none", () => {
    expect(resumeActions([card("done", { lastLine: "All done" })], vi.fn()).all).toBeUndefined();
    const { all } = resumeActions([card("a"), card("b", { sessionId: undefined })], vi.fn());
    expect(all!.count).toBe(2);
    all!.run();
    expect(api.send).toHaveBeenCalledWith("a", "continue");
    expect(api.restart).toHaveBeenCalledWith("b");
  });
});
