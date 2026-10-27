import { describe, expect, it } from "vitest";
import { chipsFor } from "./copilot-starters";

const reply = {
  chips: [
    { text: "Answer the auth card", project: "/dev/weft", covers: ["What should I build next?"] },
    { text: "Sign in to Weft" },
    { text: "Fix the groovenfill deploy", project: "/dev/groovenfill", covers: ["What's worth refactoring?"] },
    { text: "Commit weft", project: "/dev/weft" },
    { text: "Review weft", project: "/dev/weft" },
    { text: "Review groovenfill", project: "/dev/groovenfill" },
  ],
  covers: ["What should I build next?", "What's worth refactoring?"],
};

describe("chipsFor", () => {
  it("keeps one project's chips plus account-wide ones, and only their covers", () => {
    const { chips, covers } = chipsFor(reply, "/dev/groovenfill");
    expect(chips.map((c) => c.text)).toEqual(["Sign in to Weft", "Fix the groovenfill deploy", "Review groovenfill"]);
    expect([...covers]).toEqual(["What's worth refactoring?"]);
  });

  it("shows the most urgent four across every project for All", () => {
    const { chips, covers } = chipsFor(reply, null);
    expect(chips.map((c) => c.text)).toEqual(["Answer the auth card", "Sign in to Weft", "Fix the groovenfill deploy", "Commit weft"]);
    expect(covers.size).toBe(2);
  });

  it("falls back to the whole-board covers for chips without their own, and none without chips", () => {
    expect([...chipsFor({ chips: [{ text: "a" }], covers: ["x"] }, null).covers]).toEqual(["x"]);
    expect(chipsFor({ chips: [], covers: ["x"] }, null).covers.size).toBe(0);
  });
});
