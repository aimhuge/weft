import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// mcp__board__changelog_* (lib/changelog-tool.ts) against a fake SDK that hands back each tool, with the store in a temp dir.

interface CapturedTool {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-changelog-tool-"));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "weft-changelog-repo-"));
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("init", "-q");
git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "first");
fs.mkdirSync(path.join(repo, "sub"));
const cards: Record<string, { id: string; title: string; cwd: string }> = { c1: { id: "c1", title: "Login card", cwd: path.join(repo, "sub") } };

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _d: string, _s: unknown, handler: CapturedTool["handler"]) => ({ name, handler }),
}));
vi.mock("./store", () => ({ DATA_DIR: dir, getCard: (id: string) => cards[id] }));

const { changelogFile, releaseProject, stampCard } = await import("./changelog");
const { changelogTools, lineFor } = await import("./changelog-tool");
const { isTrustedTool } = await import("./board-tools-trust");

const tools = (cardId?: string, cwd = "") => Object.fromEntries((changelogTools(() => cardId, () => cwd) as unknown as CapturedTool[]).map((t) => [t.name, t]));
const call = async (name: string, args: Record<string, unknown>, cardId: string | undefined = "c1", cwd = "") => {
  const result = await tools(cardId, cwd)[name]!.handler(args);
  return { text: result.content[0]!.text, isError: result.isError };
};
const idOf = (text: string) => /Added (\S+)/.exec(text)![1];

beforeEach(() => fs.rmSync(changelogFile(), { force: true }));

describe("changelog tools", () => {
  it("are trusted board tools", () => {
    expect(Object.keys(tools())).toEqual(["changelog_add", "changelog_list", "changelog_edit"]);
    for (const name of ["changelog_add", "changelog_list", "changelog_edit"]) expect(isTrustedTool(`mcp__board__${name}`, "sdk")).toBe(true);
  });

  it("adds an entry under the card's git root, naming the card", async () => {
    const added = await call("changelog_add", { kind: "added", text: "**Login.** Works." });
    expect(added.text).toMatch(new RegExp(`to ${repo}'s changelog \\(added, draft`));
    const listed = await call("changelog_list", {});
    expect(listed.text).toBe(`${idOf(added.text)} | added | draft | Login card | **Login.** Works.`);
  });

  it("falls back to the thread's folder, then refuses with none", async () => {
    expect((await call("changelog_add", { kind: "fixed", text: "x" }, "none", repo)).text).toContain(repo);
    const none = await call("changelog_add", { kind: "fixed", text: "x" }, "none", "");
    expect(none.text).toMatch(/No project folder/);
    expect(none.isError).toBe(true);
    expect((await call("changelog_list", { folder: repo }, "none")).text).toMatch(/\| fixed \| draft \| — \| x$/);
  });

  it("hides released entries unless asked, and shows sha and version", async () => {
    expect((await call("changelog_list", {})).text).toBe("No entries yet.");
    await call("changelog_add", { kind: "added", text: "old" });
    stampCard("c1", repo, "abcdef1234");
    releaseProject(repo, "1.0.0");
    await call("changelog_add", { kind: "added", text: "new" });
    expect((await call("changelog_list", {})).text).not.toContain("old");
    expect((await call("changelog_list", { all: true })).text).toContain("| added | released abcdef1 1.0.0 | Login card | old");
  });

  it("edits and removes, and reports a store error as a tool error", async () => {
    const id = idOf((await call("changelog_add", { kind: "added", text: "a" })).text);
    expect((await call("changelog_edit", { id, text: "b", kind: "changed" })).text).toBe(`Updated: ${id} | changed | draft | Login card | b`);
    expect((await call("changelog_edit", { id, remove: true })).text).toBe(`Removed ${id}.`);
    expect(await call("changelog_edit", { id, text: "c" })).toEqual({ text: `No changelog entry ${id}.`, isError: true });
  });

  it("records the entry's files, and re-files or re-stamps it with a commit of its project", async () => {
    const id = idOf((await call("changelog_add", { kind: "added", text: "a", files: ["./lib/a.ts", "lib/a.ts", " "] })).text);
    expect((await call("changelog_list", {})).text).toContain(`${id} | added | draft`);
    const { readChangelog } = await import("./changelog");
    expect(readChangelog().find((e) => e.id === id)?.files).toEqual(["lib/a.ts"]);
    expect((await call("changelog_edit", { id, files: ["lib/b.ts"] })).text).toContain("| draft |");
    expect(readChangelog().find((e) => e.id === id)?.files).toEqual(["lib/b.ts"]);
    const sha = git("rev-parse", "HEAD");
    expect((await call("changelog_edit", { id, sha: sha.slice(0, 7) })).text).toBe(`Updated: ${id} | added | committed ${sha.slice(0, 7)} | Login card | a`);
    expect(readChangelog().find((e) => e.id === id)?.sha).toBe(sha);
    expect(await call("changelog_edit", { id, sha: "0000000" })).toEqual({ text: `0000000 isn't a commit in ${repo}.`, isError: true });
    expect(await call("changelog_edit", { id: "nope", sha })).toEqual({ text: "No changelog entry nope.", isError: true });
  });

  it("reports a non-Error throw as text", async () => {
    const t = tools("c1").changelog_add!;
    const result = await t.handler({ kind: "added", text: "", folder: repo });
    expect(result).toEqual({ content: [{ type: "text", text: "A changelog entry needs text." }], isError: true });
    expect(lineFor({ id: "i", project: "/r", kind: "added", text: "t", at: 1 })).toBe("i | added | draft | — | t");
  });
});
