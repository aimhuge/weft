import { describe, expect, it } from "vitest";
import { shouldWriteShow } from "./show";

// When a turn that showed nothing gets an update page written for it (lib/show.ts). Split from show.test.ts.

describe("shouldWriteShow", () => {
  const turn = { openedPane: false, isError: false, stopped: false, paneUrl: "" };

  it("writes when the pane is empty or shows an earlier page file", () => {
    expect(shouldWriteShow(turn)).toBe(true);
    expect(shouldWriteShow({ ...turn, paneUrl: "file:///tmp/weft-show/plan.html" })).toBe(true);
  });

  it("leaves a thread's own page and a live app alone", () => {
    expect(shouldWriteShow({ ...turn, openedPane: true })).toBe(false);
    expect(shouldWriteShow({ ...turn, paneUrl: "http://localhost:3000/" })).toBe(false);
  });

  it("skips the CLI's own slash commands, whose answer isn't the model's work", () => {
    expect(shouldWriteShow({ ...turn, ask: "/add-dir /Volumes" })).toBe(false);
    expect(shouldWriteShow({ ...turn, ask: " /compact" })).toBe(false);
  });

  it("still writes for a skill, or an ask that starts with a path", () => {
    expect(shouldWriteShow({ ...turn, ask: "/weft:preview" })).toBe(true);
    expect(shouldWriteShow({ ...turn, ask: "/add-directory-picker is broken" })).toBe(true);
    expect(shouldWriteShow({ ...turn, ask: "/Users/me/shot.png shows the bug" })).toBe(true);
  });

  it("skips failed and stopped turns, and runs without a desktop shell", () => {
    expect(shouldWriteShow({ ...turn, isError: true })).toBe(false);
    expect(shouldWriteShow({ ...turn, stopped: true })).toBe(false);
    expect(shouldWriteShow({ ...turn, paneUrl: undefined })).toBe(false);
  });
});
