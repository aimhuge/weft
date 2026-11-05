// The app knows an update landed by the version changing since the last launch: Squirrel swaps the
// bundle and restarts the app, and the new bundle's dependency trees are installed then.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updatedSince, recordVersion, versionFile } from "./updated-since.cjs";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-updated-since-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("updatedSince", () => {
  it("is true the first time, so a fresh install installs its tree too", () => {
    expect(updatedSince({ dataDir: dir, version: "0.6.5" })).toBe(true);
  });

  it("is true when the version moved — an update landed", () => {
    recordVersion({ dataDir: dir, version: "0.6.5" });
    expect(updatedSince({ dataDir: dir, version: "0.6.6" })).toBe(true);
  });

  it("is false on an ordinary relaunch of the same version", () => {
    recordVersion({ dataDir: dir, version: "0.6.5" });
    expect(updatedSince({ dataDir: dir, version: "0.6.5" })).toBe(false);
  });

  it("is true for a downgrade, which also brings a new bundle", () => {
    recordVersion({ dataDir: dir, version: "0.6.6" });
    expect(updatedSince({ dataDir: dir, version: "0.6.5" })).toBe(true);
  });
});

describe("recordVersion", () => {
  it("writes the version, and creates the folder", () => {
    const nested = path.join(dir, "nested");
    expect(recordVersion({ dataDir: nested, version: "0.6.5" })).toBe(true);
    expect(fs.readFileSync(versionFile(nested), "utf8").trim()).toBe("0.6.5");
  });

  it("survives an unwritable folder", () => {
    const file = path.join(dir, "file");
    fs.writeFileSync(file, "");
    expect(recordVersion({ dataDir: path.join(file, "nested"), version: "0.6.5" })).toBe(false);
  });
});
