import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dir: "" }));
h.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-issue-record-"));
vi.mock("./store", () => ({
  get DATA_DIR() {
    return h.dir;
  },
}));

const { importedIssues, knownIssues, rememberIssues, saveImportedIssues } = await import("./issue-record");
const file = () => path.join(h.dir, "github-issues.json");

beforeEach(() => fs.rmSync(file(), { force: true }));
afterAll(() => fs.rmSync(h.dir, { recursive: true, force: true }));

describe("the imported-issues record", () => {
  it("is empty with no file, an unreadable one, or one with no record", () => {
    expect(importedIssues()).toEqual({});
    fs.writeFileSync(file(), "{nope");
    expect(importedIssues()).toEqual({});
    fs.writeFileSync(file(), "{}");
    expect(knownIssues("acme/app")).toEqual(new Set());
  });

  it("remembers numbers per repo, case-insensitively", () => {
    rememberIssues("Acme/App", [1, 2]);
    rememberIssues("acme/app", [3]);
    expect(knownIssues("ACME/app")).toEqual(new Set([1, 2, 3]));
    saveImportedIssues({ "x/y": [9] });
    expect(importedIssues()).toEqual({ "x/y": [9] });
  });
});
