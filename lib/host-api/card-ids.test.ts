import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardIds, MAX_IDS } from "./card-ids";

describe("cardIds", () => {
  it("remembers ids on disk, keeps the newest MAX_IDS, and reads a missing or broken file as none", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wids-"));
    const file = path.join(dir, "sub", "ids.json");
    const ids = cardIds(file);
    expect(ids.used("a")).toBe(false);
    ids.remember("a");
    expect(cardIds(file).used("a")).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.writeFileSync(file, JSON.stringify(Array.from({ length: MAX_IDS }, (_, i) => `x${i}`)));
    ids.remember("b");
    expect(ids.used("x0")).toBe(false);
    expect(ids.used("b")).toBe(true);
    fs.writeFileSync(file, '{"not":"a list"}');
    expect(ids.used("b")).toBe(false);
    fs.writeFileSync(file, '["c", 3]');
    expect(ids.used("c")).toBe(true);
    fs.writeFileSync(file, "garbage");
    expect(ids.used("c")).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lives in the data folder by default", () => {
    expect(typeof cardIds().used).toBe("function");
  });
});
