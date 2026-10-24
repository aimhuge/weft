import { describe, expect, it } from "vitest";
import { poolKey, poolOf, samePool } from "./plan-pools";

describe("poolOf", () => {
  it("puts Claude Code and puku-cli in one pool: they read one account's windows", () => {
    expect(poolOf("claude")).toEqual(["claude", "puku"]);
    expect(poolOf("puku")).toEqual(["claude", "puku"]);
  });

  it("gives every other CLI its own pool", () => {
    expect(poolOf("codex")).toEqual(["codex"]);
    expect(poolOf("goose")).toEqual(["goose"]);
  });
});

describe("samePool", () => {
  it("is true for two CLIs on the same plan", () => {
    expect(samePool("claude", "puku")).toBe(true);
    expect(samePool("puku", "claude")).toBe(true);
  });

  it("is false for CLIs on different plans", () => {
    expect(samePool("claude", "codex")).toBe(false);
    expect(samePool("claude", "goose")).toBe(false);
    expect(samePool("codex", "goose")).toBe(false);
  });

  it("is true for a CLI with itself", () => {
    expect(samePool("codex", "codex")).toBe(true);
  });
});

describe("poolKey", () => {
  it("names a pool by one of its CLIs, so the plan has one key", () => {
    expect(poolKey("claude")).toBe("claude");
    expect(poolKey("puku")).toBe("claude");
    expect(poolKey("codex")).toBe("codex");
    expect(poolKey("goose")).toBe("goose");
  });
});
