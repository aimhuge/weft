import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script
import { lintableFiles, partitionProblems, shardFiles } from "./lint-shard.mjs";

const tracked = ["a.ts", "b.tsx", "c.mjs", "d.cjs", "e.md", "f.png", "g.jsx", "lib/h.test.ts"];

describe("lint-shard", () => {
  it("keeps only the extensions eslint lints", () => {
    expect(lintableFiles(tracked)).toEqual(["a.ts", "b.tsx", "c.mjs", "d.cjs", "g.jsx", "lib/h.test.ts"]);
  });
  it("puts every file in exactly one of the shards", () => {
    const files = lintableFiles(tracked);
    expect(partitionProblems(files, 3)).toEqual([]);
    const all = [1, 2, 3].flatMap((i) => shardFiles(files, i, 3));
    expect([...all].sort()).toEqual([...files].sort());
  });
});
