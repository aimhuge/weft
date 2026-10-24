// @vitest-environment node
// Where a card's Goose state lives: under Weft's data dir, one folder per card.
import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gooseStateRoot", () => {
  it("puts the card's state under the data dir Weft was given", async () => {
    vi.stubEnv("WEFT_DATA", "/tmp/weft-data");
    const { gooseStateRoot } = await import("./goose-state");
    expect(gooseStateRoot("card-1")).toBe(path.join("/tmp/weft-data", "goose", "card-1"));
  });

  it("falls back to the home folder when no data dir was given", async () => {
    vi.stubEnv("WEFT_DATA", "");
    vi.stubEnv("HOME", "/tmp/weft-home");
    const { gooseStateRoot } = await import("./goose-state");
    expect(gooseStateRoot("card-1")).toBe(path.join("/tmp/weft-home", ".weft", "goose", "card-1"));
  });

  it("falls back to the temp folder when there is no home folder either", async () => {
    vi.stubEnv("WEFT_DATA", "");
    vi.stubEnv("HOME", "");
    const { gooseStateRoot } = await import("./goose-state");
    expect(gooseStateRoot("card-1")).toBe(path.join("/tmp", ".weft", "goose", "card-1"));
  });

  it("gives every card its own folder, so two cards never share one Goose database", async () => {
    vi.stubEnv("WEFT_DATA", "/tmp/weft-data");
    const { gooseStateRoot } = await import("./goose-state");
    expect(gooseStateRoot("card-1")).not.toBe(gooseStateRoot("card-2"));
  });
});
