import { describe, expect, it } from "vitest";
import { createEngine, wins } from "./tree-sync-engine";
import type { FileState, Files } from "./tree-sync-protocol";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

// Two ends over an in-memory wire: each has its folder (path → state) and an engine; changes are delivered at once.
function pair(winner: "x" | "y" = "x") {
  const ends = {
    x: { folder: {} as Files, copies: [] as string[], engine: createEngine(() => winner === "x") },
    y: { folder: {} as Files, copies: [] as string[], engine: createEngine(() => winner === "y") },
  };
  const read = (f: Files, p: string): FileState => (p in f ? (f[p] as FileState) : "HEAD");
  const write = (f: Files, p: string, s: FileState) => {
    if (s === "HEAD") Reflect.deleteProperty(f, p);
    else f[p] = s;
  };
  function deliver(to: "x" | "y", change: { path: string; state: FileState; base: FileState; conflict?: true }) {
    const end = ends[to];
    const d = end.engine.remote(change, read(end.folder, change.path));
    if (d.kind === "take") {
      if (d.keepCopy) end.copies.push(`${change.path}=${read(end.folder, change.path)}`);
      write(end.folder, change.path, change.state);
    }
    if (d.kind === "keep") deliver(to === "x" ? "y" : "x", d.reply);
  }
  function hello() {
    const fromX = ends.x.engine.start({ ...ends.x.folder }, { ...ends.y.folder });
    const fromY = ends.y.engine.start({ ...ends.y.folder }, { ...ends.x.folder });
    fromX.forEach((c) => deliver("y", c));
    fromY.forEach((c) => deliver("x", c));
  }
  function edit(at: "x" | "y", p: string, s: FileState) {
    write(ends[at].folder, p, s);
    const out = ends[at].engine.local(p, s);
    if (out) deliver(at === "x" ? "y" : "x", out);
  }
  return { ends, hello, edit };
}

describe("tree sync engine", () => {
  it("sends what only one end changed, both ways, at hello", () => {
    const { ends, hello } = pair();
    ends.x.folder = { "a.ts": A, "gone.ts": null };
    ends.y.folder = { "b.ts": B };
    hello();
    expect(ends.x.folder).toEqual({ "a.ts": A, "gone.ts": null, "b.ts": B });
    expect(ends.y.folder).toEqual(ends.x.folder);
    expect(ends.x.copies).toEqual([]);
    expect(ends.y.copies).toEqual([]);
  });

  it("carries live edits, deletes and reverts to HEAD", () => {
    const { ends, hello, edit } = pair();
    hello();
    edit("x", "a.ts", A);
    edit("y", "a.ts", B);
    edit("x", "old.ts", null);
    edit("y", "a.ts", "HEAD");
    expect(ends.x.folder).toEqual({ "old.ts": null });
    expect(ends.y.folder).toEqual({ "old.ts": null });
  });

  it("settles a clash at hello on the winner's file, the loser keeping a copy", () => {
    const { ends, hello } = pair("y");
    ends.x.folder = { "a.ts": A };
    ends.y.folder = { "a.ts": B };
    hello();
    expect(ends.x.folder).toEqual({ "a.ts": B });
    expect(ends.y.folder).toEqual({ "a.ts": B });
    expect(ends.x.copies).toEqual([`a.ts=${A}`]);
    expect(ends.y.copies).toEqual([]);
  });

  it("settles crossing edits the same way on both ends", () => {
    const { ends, hello } = pair("x");
    hello();
    // Both edit before either hears the other.
    ends.x.folder["a.ts"] = A;
    ends.y.folder["a.ts"] = B;
    const fromX = ends.x.engine.local("a.ts", A);
    const fromY = ends.y.engine.local("a.ts", B);
    const dy = ends.y.engine.remote(fromX!, B);
    const dx = ends.x.engine.remote(fromY!, A);
    expect(dy).toEqual({ kind: "take", keepCopy: true });
    expect(dx).toEqual({ kind: "keep", reply: { path: "a.ts", state: A, base: B, conflict: true } });
    // The winner's reply lands where the file already is.
    expect(ends.y.engine.remote((dx as Extract<typeof dx, { kind: "keep" }>).reply, A)).toEqual({ kind: "same" });
  });

  it("remembers bases across lines, so a change made while apart isn't a clash", () => {
    const x = createEngine(() => true);
    const y = createEngine(() => false);
    x.start({ "a.ts": A }, { "a.ts": A });
    y.start({ "a.ts": A }, { "a.ts": A });
    const x2 = createEngine(() => true, x.saved());
    const y2 = createEngine(() => false, y.saved());
    // y moved to C while the line was down; x didn't move.
    expect(x2.start({ "a.ts": A }, { "a.ts": C })).toEqual([]);
    expect(y2.start({ "a.ts": C }, { "a.ts": A })).toEqual([{ path: "a.ts", state: C, base: A }]);
  });

  it("sends nothing for a path that's where the other end has it", () => {
    const e = createEngine(() => true);
    expect(e.local("a.ts", "HEAD")).toBeNull();
    expect(e.local("a.ts", A)).toEqual({ path: "a.ts", state: A, base: "HEAD" });
    expect(e.local("a.ts", A)).toBeNull();
    expect(e.saved()).toEqual({ "a.ts": A });
    e.forget();
    expect(e.baseOf("a.ts")).toBe("HEAD");
  });

  it("keeps no copy of a file HEAD holds", () => {
    const e = createEngine(() => false);
    expect(e.remote({ path: "a.ts", state: A, base: B }, "HEAD")).toEqual({ kind: "take", keepCopy: false });
    expect(e.remote({ path: "b.ts", state: A, base: B }, null)).toEqual({ kind: "take", keepCopy: false });
    expect(e.remote({ path: "c.ts", state: A, base: "HEAD", conflict: true }, "HEAD")).toEqual({ kind: "take", keepCopy: false });
  });

  it("decides a clash by priority, then id", () => {
    expect(wins({ prio: 2, id: "a" }, { prio: 1, id: "z" })).toBe(true);
    expect(wins({ prio: 1, id: "a" }, { prio: 2, id: "z" })).toBe(false);
    expect(wins({ prio: 1, id: "b" }, { prio: 1, id: "a" })).toBe(true);
    expect(wins({ prio: 1, id: "a" }, { prio: 1, id: "b" })).toBe(false);
  });
});
