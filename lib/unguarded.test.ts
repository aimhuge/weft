import { describe, expect, it } from "vitest";
import { BACKEND_IDS } from "./new-thread";
import { unguarded, unguardedNotice, UNGUARDED_TAG } from "./unguarded";

describe("unguarded", () => {
  it("marks Codex and Goose, which have no per-tool hooks, and only them", () => {
    expect(BACKEND_IDS.filter(unguarded)).toEqual(["codex", "goose"]);
  });

  it("names the CLI and what it skips in one line", () => {
    expect(unguardedNotice("codex")).toBe("Codex runs without Weft's guards: no secret guard, folder gate or Bash hooks.");
    expect(unguardedNotice("goose")).toMatch(/^Goose runs without Weft's guards/);
    expect(unguardedNotice("claude")).toBeNull();
    expect(unguardedNotice("puku")).toBeNull();
    expect(UNGUARDED_TAG).toBe("no Weft guards");
  });
});
