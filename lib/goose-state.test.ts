// @vitest-environment node
// Where a card's Goose state lives: under Weft's data dir, one folder per card.
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
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

describe("gooseHasSession", () => {
  it("is true once Goose has made the card's session database, and not before", async () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "goose-state-"));
    vi.stubEnv("WEFT_DATA", data);
    const { gooseHasSession, gooseStateRoot } = await import("./goose-state");
    expect(gooseHasSession("card-1")).toBe(false);
    const sessions = path.join(gooseStateRoot("card-1"), "data", "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, "sessions.db"), "");
    expect(gooseHasSession("card-1")).toBe(true);
  });
});
