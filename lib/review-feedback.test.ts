// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllFeedback,
  collectFeedback,
  feedbackKey,
  flushFeedback,
  sendStepFeedback,
  unsentCount,
  unsentSteps,
} from "./review-feedback";

beforeEach(() => localStorage.clear());

describe("review feedback drafts", () => {
  it("keeps each step's feedback in its own slot", () => {
    localStorage.setItem(feedbackKey("c1", 0), "first note");
    localStorage.setItem(feedbackKey("c1", 1), "second note");
    expect(unsentSteps("c1", [0, 1, 2])).toEqual([0, 1]);
    expect(unsentCount("c1", [0, 1, 2])).toBe(2);
  });

  it("counts a step as unsent only while it holds something", () => {
    expect(unsentCount("c1", [0, 1])).toBe(0);
    localStorage.setItem(feedbackKey("c1", 1), "   ");
    expect(unsentCount("c1", [0, 1])).toBe(0);
  });

  it("collects the feedback of every step that has some, in tour order", () => {
    localStorage.setItem(feedbackKey("c1", 0), "the login is broken");
    localStorage.setItem(feedbackKey("c1", 2), "the logo is wrong");
    const message = collectFeedback("c1", [{ title: "Sign-in" }, { title: "Home" }, { title: "Logo" }]);
    expect(message).toContain("step 1 of 3, “Sign-in”:\nthe login is broken");
    expect(message).toContain("step 3 of 3, “Logo”:\nthe logo is wrong");
    expect(message).not.toContain("step 2 of 3");
  });

  it("has nothing to collect when no step holds feedback", () => {
    expect(collectFeedback("c1", [{ title: "Sign-in" }])).toBeUndefined();
  });

  it("forgets the feedback of the steps it was told to", () => {
    localStorage.setItem(feedbackKey("c1", 0), "note");
    localStorage.setItem(feedbackKey("c1", 1), "another");
    clearAllFeedback("c1", [0, 1]);
    expect(unsentCount("c1", [0, 1])).toBe(0);
  });
});

describe("flushing review feedback", () => {
  const steps = [{ title: "Sign-in" }, { title: "Home" }, { title: "Logo" }];

  it("sends every step's unsent feedback in one message", async () => {
    localStorage.setItem(feedbackKey("c1", 0), "the login is broken");
    localStorage.setItem(feedbackKey("c1", 2), "the logo is wrong");
    const send = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    await flushFeedback("c1", steps, send);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]![0];
    expect(message).toContain("the login is broken");
    expect(message).toContain("the logo is wrong");
  });

  it("forgets the feedback it sent", async () => {
    localStorage.setItem(feedbackKey("c1", 0), "the login is broken");
    await flushFeedback("c1", steps, vi.fn(() => Promise.resolve()));
    expect(unsentCount("c1", [0, 1, 2])).toBe(0);
  });

  it("sends nothing when no step holds feedback", async () => {
    const send = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    await flushFeedback("c1", steps, send);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the feedback when sending it fails", async () => {
    localStorage.setItem(feedbackKey("c1", 0), "the login is broken");
    const send = vi.fn<(text: string) => Promise<void>>(() => Promise.reject(new Error("offline")));
    await expect(flushFeedback("c1", steps, send)).rejects.toThrow("offline");
    expect(unsentCount("c1", [0, 1, 2])).toBe(1);
  });

  it("counts the steps that actually had something to say", async () => {
    localStorage.setItem(feedbackKey("c1", 0), "the login is broken");
    localStorage.setItem(feedbackKey("c1", 2), "the logo is wrong");
    const send = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    expect(await flushFeedback("c1", steps, send)).toBe(2);
  });
});

describe("sending one step's feedback", () => {
  it("names the step it was written on and forgets it", async () => {
    localStorage.setItem(feedbackKey("c1", 1), "the logo is wrong");
    const send = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    await sendStepFeedback("c1", 1, "Home", 3, send);
    expect(send.mock.calls[0]![0]).toBe(
      'Review feedback on step 2 of 3, “Home”:\nthe logo is wrong',
    );
    expect(unsentCount("c1", [0, 1, 2])).toBe(0);
  });

  it("sends nothing when that step holds nothing", async () => {
    const send = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    await sendStepFeedback("c1", 1, "Home", 3, send);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the feedback when sending it fails", async () => {
    localStorage.setItem(feedbackKey("c1", 1), "the logo is wrong");
    const send = vi.fn<(text: string) => Promise<void>>(() => Promise.reject(new Error("offline")));
    await expect(sendStepFeedback("c1", 1, "Home", 3, send)).rejects.toThrow("offline");
    expect(unsentCount("c1", [0, 1, 2])).toBe(1);
  });
});
