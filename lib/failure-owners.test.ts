import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Card } from "./types";

const { failureNote, failurePaths } = await import("./failure-owners");

// Failure ownership (lib/failure-owners.ts): after a check fails, tell the thread which of the failures
// sit in files another busy card is editing, so it doesn't spend turns fixing another card's work in a
// shared tree. Real files on disk: failurePaths resolves paths it finds (realpathSync) and falls back to
// the repo root when a name isn't relative to the folder the command ran in.

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-failures-")));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const root = path.join(tmp, "repo");
const lib = path.join(root, "lib");
fs.mkdirSync(lib, { recursive: true });
const a = path.join(lib, "a.ts");
const b = path.join(lib, "b.ts");
fs.writeFileSync(a, "export const a = 1;\n");
fs.writeFileSync(b, "export const b = 2;\n");

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: `Card ${id}`, prompt: "", cwd: root, backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...over };
}

beforeEach(() => {
  for (const f of [a, b]) fs.writeFileSync(f, fs.readFileSync(f, "utf8"));
});

describe("failurePaths", () => {
  it("reads a tsc error position, a bare position and a vitest FAIL line, relative to the folder", () => {
    expect(failurePaths("lib/a.ts(3,4): error TS2304: Cannot find name 'x'.", lib, root)).toEqual([a]);
    expect(failurePaths("lib/a.ts:3:4 - error TS2304: Cannot find name 'x'.", lib, root)).toEqual([a]);
    expect(failurePaths(" FAIL  lib/b.test.ts > thing", lib, root)).toEqual([path.join(lib, "b.test.ts")]);
  });

  it("keeps absolute paths and quotes the names inside them", () => {
    expect(failurePaths(`  at ${a}(9,1)`, root, root)).toEqual([a]);
    expect(failurePaths(`'${b}': error TS1`, root, root)).toEqual([b]);
  });

  it("falls back to the repo root for a name that isn't under the folder the command ran in", () => {
    // A path that doesn't exist under cwd resolves against the root instead (pnpm test prints from the root).
    expect(failurePaths("lib/a.ts(1,1): error TS1", path.join(root, "components"), root)).toEqual([a]);
  });

  it("reads every extension the pattern knows, once each, and stops at its cap", () => {
    const names = ["x.tsx", "x.jsx", "x.mjs", "x.cjs", "x.mts", "x.cts", "x.css"];
    // None exist under lib, so each falls back to the repo root.
    expect(failurePaths(names.map((n) => `${n}: error TS1`).join("\n"), lib, root)).toEqual(names.map((n) => path.join(root, n)));
    expect(failurePaths("lib/a.ts(1,1): error\nlib/a.ts(2,2): error", lib, root)).toEqual([a]);
    const many = Array.from({ length: 250 }, (_, i) => `f${i}.ts: error`).join("\n");
    expect(failurePaths(many, lib, root)).toHaveLength(200);
  });
});

describe("failureNote", () => {
  const me = card("me");
  const other = card("other", { title: "Fix login", claims: [`${a}#*`] });

  it("says nothing for a command that isn't a check, or output with no failure in it", () => {
    expect(failureNote("ls -la", `error TS1 in ${a}(1,1)`, root, root, me, [me, other])).toBeUndefined();
    expect(failureNote("pnpm typecheck", "No errors found", root, root, me, [me, other])).toBeUndefined();
  });

  it("says nothing when no other busy card in the tree holds a claim", () => {
    const quiet = card("other", { title: "Idle elsewhere", claims: [`${a}#*`], column: "done" });
    expect(failureNote("pnpm typecheck", `${a}(1,1): error TS1`, root, root, me, [me, quiet])).toBeUndefined();
    expect(failureNote("pnpm typecheck", `${a}(1,1): error TS1`, root, root, me, [me])).toBeUndefined();
  });

  it("names the holding card for a failure in a file it claims", () => {
    const note = failureNote("pnpm typecheck", `${a}(3,4): error TS2304: Cannot find name 'x'.`, root, root, me, [me, other]) as string;
    expect(note).toContain("Some of these failures are in files another card is editing right now");
    expect(note).toContain("- lib/a.ts: ‘Fix login’");
    expect(note).toContain("Leave those to that card");
  });

  it("lists their files as maybe theirs when no failure is in one of them", () => {
    const note = failureNote("pnpm vitest run", `${b}(1,1): error TS1`, root, root, me, [me, other]) as string;
    expect(note).toContain("a failure here may be theirs");
    expect(note).toContain("- lib/a.ts: ‘Fix login’");
    expect(note).toContain("leave it to that card");
    expect(note).not.toContain("lib/b.ts");
  });

  it("lists at most eight files, whether they own the failures or not", () => {
    const many = Array.from({ length: 12 }, (_, i) => card(`c${i}`, { title: `Card ${i}`, claims: [`${path.join(lib, `f${i}.ts`)}#*`] }));
    const mine = failureNote("pnpm lint", many.map((c) => `${path.join(lib, `f${c.id.slice(1)}.ts`)}: error`).join("\n"), root, root, me, [me, ...many]) as string;
    expect(mine.match(/^- /gm)).toHaveLength(8);
    expect(mine).toContain("- lib/f7.ts: ‘Card 7’");
    expect(mine).not.toContain("- lib/f8.ts:");
    const theirs = failureNote("pnpm lint", `${path.join(lib, "mine.ts")}: error`, root, root, me, [me, ...many]) as string;
    expect(theirs.match(/^- /gm)).toHaveLength(8);
    expect(theirs).not.toContain("lib/f8.ts");
  });

  it("ignores claims from cards in another tree, archived, copilot or this card", () => {
    const away = card("away", { claims: [`${a}#*`], cwd: path.join(tmp, "elsewhere") });
    const archived = card("archived", { claims: [`${a}#*`], archived: true });
    const copilot = card("copilot", { claims: [`${a}#*`], role: "copilot" });
    const waiting = card("waiting", { claims: [`${a}#*`], column: "needs_you" });
    expect(failureNote("pnpm typecheck", `${a}(1,1): error TS1`, root, root, me, [me, away, archived, copilot])).toBeUndefined();
    expect(failureNote("pnpm typecheck", `${a}(1,1): error TS1`, root, root, me, [me, waiting])).toContain("- lib/a.ts: ‘Card waiting’");
    const self = card("me", { claims: [`${a}#*`] });
    expect(failureNote("pnpm typecheck", `${a}(1,1): error TS1`, root, root, self, [self])).toBeUndefined();
  });

  it("counts one card's two claims on one file once, the first holder winning", () => {
    const two = card("two", { title: "Second", claims: [`${a}#one`, `${a}#two`] });
    const note = failureNote("pnpm typecheck", `${a}(1,1): error TS1`, root, root, me, [me, other, two]) as string;
    expect(note.match(/^- /gm)).toHaveLength(1);
    expect(note).toContain("‘Fix login’");
  });
});
describe("files whose writer is unknown", () => {
  const me = card("me");
  const other = card("other", { title: "Fix login", claims: [`${a}#*`] });
  const unknown = new Set([b]);

  it("calls them unknown, never another card's, whether or not another card holds claims", () => {
    const alone = failureNote("pnpm typecheck", `${b}(1,1): error TS1`, root, root, me, [me], unknown) as string;
    expect(alone).toContain("- lib/b.ts: unknown");
    expect(alone).toContain("they're yours to fix");
    const both = failureNote("pnpm typecheck", `${a}(1,1): error TS1\n${b}(1,1): error TS1`, root, root, me, [me, other], unknown) as string;
    expect(both).toContain("- lib/a.ts: ‘Fix login’");
    expect(both).toContain("- lib/b.ts: unknown");
    const maybe = failureNote("pnpm typecheck", `${b}(1,1): error TS1`, root, root, me, [me, other], unknown) as string;
    expect(maybe).toContain("- lib/b.ts: unknown");
    expect(maybe).toContain("may be theirs");
    expect(maybe).not.toContain("lib/b.ts: ‘");
  });

  it("leaves out unknown files this card or another card claims, and stays quiet without a failure", () => {
    const mine = card("me", { claims: [`${b}#*`] });
    expect(failureNote("pnpm typecheck", `${b}(1,1): error TS1`, root, root, mine, [mine], unknown)).toBeUndefined();
    expect(failureNote("pnpm typecheck", `${a}(1,1): error TS1`, root, root, me, [me, other], new Set([a]))).not.toContain("unknown");
    expect(failureNote("pnpm typecheck", "No errors found", root, root, me, [me], unknown)).toBeUndefined();
    // Only non-source files open elsewhere: the unknown list alone.
    const docs = card("docs", { title: "Docs", claims: [`${path.join(root, "CHANGELOG.md")}#*`] });
    expect(failureNote("pnpm typecheck", `${b}(1,1): error TS1`, root, root, me, [me, docs], unknown)).toMatch(/^Weft can't tell[\s\S]*lib\/b\.ts: unknown/);
  });
});
describe("what counts as a check", () => {
  const me = card("me");
  const other = card("other", { title: "Fix login", claims: [`${a}#*`] });
  const out = `${path.join(lib, "zz.ts")}(1,1): error TS1`;

  it("is the command that runs, not a word in the line", () => {
    expect(failureNote("grep -n error lib/a.test.ts", out, root, root, me, [me, other])).toBeUndefined();
    expect(failureNote("sed -n 1,5p lib/build.ts", out, root, root, me, [me, other])).toBeUndefined();
  });

  it("covers the tools themselves and package scripts, through run, exec and npx", () => {
    for (const command of ["tsc --noEmit", "npx vitest run", "pnpm run test", "pnpm exec eslint lib", "npm test -- --watch=false", "next build", "cd lib && pnpm lint"])
      expect(failureNote(command, out, root, root, me, [me, other]), command).toContain("may be theirs");
  });

  it("leaves out files that can't break a caller, and stays quiet when only those are open", () => {
    const docs = card("docs", { title: "Docs", claims: [`${path.join(root, "CHANGELOG.md")}#*`] });
    expect(failureNote("pnpm typecheck", out, root, root, me, [me, docs])).toBeUndefined();
    expect(failureNote("pnpm typecheck", out, root, root, me, [me, docs, other])).not.toContain("CHANGELOG.md");
  });

  it("stays quiet when every failure is in this card's own files", () => {
    const mine = card("me", { claims: [`${b}#*`] });
    expect(failureNote("pnpm typecheck", `${b}(1,1): error TS1`, root, root, mine, [mine, other])).toBeUndefined();
  });
});
