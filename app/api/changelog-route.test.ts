import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/changelog: a project's changelog for the Changelog dialog. The store runs for real in a
// temp dir; the project is a temp git repo.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-changelog-route-"));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "weft-changelog-route-repo-"));
fs.mkdirSync(path.join(repo, ".git"));
vi.mock("@/lib/store", () => ({ DATA_DIR: dir }));

const { addEntry, changelogFile } = await import("@/lib/changelog");
const route = await import("./changelog/route");

const READ = { host: "localhost:3457" };

beforeEach(() => {
  fs.rmSync(changelogFile(), { force: true });
  fs.rmSync(path.join(repo, "CHANGELOG.md"), { force: true });
});

describe("/api/changelog", () => {
  it("lists a folder's project entries, newest first", async () => {
    addEntry({ project: repo, kind: "added", text: "old", at: 1 });
    addEntry({ project: repo, kind: "fixed", text: "new", at: 2 });
    const res = route.GET(new Request(`http://localhost:3457/api/changelog?folder=${encodeURIComponent(repo)}`, { headers: READ }));
    const body = (await res.json()) as { project: string; entries: { text: string }[] };
    expect(body.project).toBe(repo);
    expect(body.entries.map((e) => e.text)).toEqual(["new", "old"]);
  });

  it("needs a folder and a local host", () => {
    expect((route.GET(new Request("http://localhost:3457/api/changelog", { headers: READ }))).status).toBe(400);
    expect((route.GET(new Request("http://evil.test/api/changelog?folder=/x", { headers: { host: "evil.test" } }))).status).toBe(403);
  });
});
