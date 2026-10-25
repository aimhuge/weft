import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  execFile: vi.fn(),
  repoOf: vi.fn(() => Promise.resolve("o/r")),
  statusOf: vi.fn((): Promise<unknown> => Promise.resolve({ folders: [] })),
  checkProject: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFile: h.execFile }));
vi.mock("./github-issues", () => ({ repoOf: h.repoOf }));
vi.mock("./copilot-sources", () => ({ statusOf: h.statusOf }));
vi.mock("./project-checks", () => ({ checkProject: h.checkProject }));
vi.mock("./store", () => ({ listCards: () => [] }));

const { findSeeds, FIND_DEPS } = await import("./project-seed-find");

let dir: string;
type Cb = (err: Error | null, out?: { stdout: string }) => void;
const issue = (n: number) => ({ number: n, title: `I${n}`, url: "u", state: "OPEN", updatedAt: "t" });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-seed-find-"));
  h.execFile.mockImplementation((cmd: string, args: string[], _o: unknown, cb: Cb) => {
    if (cmd === "git") cb(null, { stdout: ["a.ts:1:TODO", "a.ts:2:TODO", "a.ts:3:TODO", "a.ts:4:FIXME"].join("\n") });
    else if (args.includes("--assignee")) cb(null, { stdout: JSON.stringify([issue(1)]) });
    else if (args.includes("bug")) cb(new Error("no label"));
    else cb(null, { stdout: "[]" });
  });
  h.checkProject.mockReturnValue({ root: dir, name: "r", stack: [], ok: { envIgnored: false }, score: null, coverage: null, perfect: false, clean: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("findSeeds", () => {
  it("finds every source: agent docs, migrations, issues, checks and a TODO cluster", async () => {
    h.statusOf.mockResolvedValueOnce({ folders: [{ folder: dir, migrations: 2, link: { ref: "abc", name: "P", source: "cli", pending: ["001_a"] } }] });
    const seeds = await findSeeds(dir);
    expect(seeds.map((s) => s.kind)).toEqual(["agents", "migrations", "issue", "check", "todo"]);
    expect(seeds[1]?.prompt).toContain("001_a");
    expect(seeds[2]?.issue).toEqual({ repo: "o/r", issue: issue(1) });
    expect(h.execFile.mock.calls.find((c) => c[0] === "gh")?.[1]).toContain("o/r");
  });

  it("leaves out what the project already has and what can't be asked", async () => {
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "x");
    h.statusOf.mockRejectedValueOnce(new Error("no pane"));
    h.repoOf.mockRejectedValueOnce(new Error("no remote"));
    h.checkProject.mockImplementationOnce(() => {
      throw new Error("not a repo");
    });
    h.execFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: Cb) => cb(new Error("git failed")));
    expect(await findSeeds(dir)).toEqual([]);
  });

  it("skips a linked project with nothing pending", async () => {
    h.statusOf.mockResolvedValueOnce({ folders: [{ folder: dir, link: { ref: "abc", pending: [] } }] });
    const kinds = (await findSeeds(dir, { ...FIND_DEPS, todos: () => Promise.resolve("") })).map((s) => s.kind);
    expect(kinds).toEqual(["agents", "issue", "check"]);
    h.statusOf.mockResolvedValueOnce({});
    expect((await findSeeds(dir)).map((s) => s.kind)).not.toContain("migrations");
  });
});
