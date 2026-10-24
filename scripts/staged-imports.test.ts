import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aliasMap, candidates, importSpecifiers, missingImports } from "./staged-imports.mjs";

const script = path.resolve(import.meta.dirname, "staged-imports.mjs");

describe("importSpecifiers", () => {
  it("finds static, side-effect, re-export, dynamic and require imports, not commented ones", () => {
    const src = [
      'import a from "./a";',
      'import { b } from "@/lib/b";',
      'import "./side.css";',
      'export * from "../c";',
      'const d = await import("./d");',
      'const e = require("./e.cjs");',
      '// import f from "./f";',
      '/* import g from "./g"; */',
      'const url = "http://x/y";',
    ].join("\n");
    expect(importSpecifiers(src)).toEqual(["./a", "@/lib/b", "./side.css", "../c", "./d", "./e.cjs"]);
  });
});

describe("candidates", () => {
  const aliases = aliasMap({ compilerOptions: { paths: { "@/*": ["./*"] } } });

  it("reads tsconfig paths as prefixes", () => {
    expect(aliases).toEqual([["@/", ["./"]]]);
  });

  it("resolves relative and alias imports, with extensions and index files", () => {
    expect(candidates("./x", "components/a.ts", aliases)).toContain("components/x.tsx");
    expect(candidates("../lib/y", "components/a.ts", aliases)).toContain("lib/y/index.ts");
    expect(candidates("@/lib/z", "app/page.tsx", aliases)).toContain("lib/z.ts");
    expect(candidates("./w.js", "lib/a.ts", aliases)).toContain("lib/w.ts");
  });

  it("leaves package imports alone", () => {
    expect(candidates("react", "a.ts", aliases)).toBeNull();
    expect(candidates("node:fs", "a.ts", aliases)).toBeNull();
  });
});

describe("missingImports", () => {
  const aliases = aliasMap({ compilerOptions: { paths: { "@/*": ["./*"] } } });
  const run = (sources: Record<string, string>, indexed: string[], untracked: string[]) =>
    missingImports({ staged: Object.keys(sources), indexed: new Set(indexed), untracked: new Set(untracked), read: (f: string) => sources[f] ?? "", aliases });

  it("names an import that resolves only to an untracked file", () => {
    const sources = { "components/board-palette.ts": 'import { replay } from "@/lib/achievement-replay";' };
    expect(run(sources, ["components/board-palette.ts"], ["lib/achievement-replay.ts"])).toEqual([
      { file: "components/board-palette.ts", spec: "@/lib/achievement-replay", untracked: "lib/achievement-replay.ts" },
    ]);
  });

  it("passes when the imported file is in the index", () => {
    const sources = { "components/ProjectMenu.tsx": 'import { open } from "@/lib/changelog-open";' };
    expect(run(sources, ["components/ProjectMenu.tsx", "lib/changelog-open.ts"], [])).toEqual([]);
  });

  it("leaves to tsc an import that resolves nowhere, and skips non-code files", () => {
    expect(run({ "a.ts": 'import x from "./typo";', "README.md": 'import x from "./b";' }, [], ["b.ts"])).toEqual([]);
  });
});

describe("staged-imports.mjs in a real repo", () => {
  let repo = "";
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const write = (file: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), body);
  };
  const check = () => spawnSync("node", [script], { cwd: repo, encoding: "utf8" });

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-staged-imports-")));
    git("init", "-q");
    write("tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }));
    write("components/board-palette.ts", 'import { replay } from "@/lib/achievement-replay";\nexport const x = replay;\n');
    write("lib/achievement-replay.ts", "export const replay = 1;\n");
    git("add", "tsconfig.json", "components/board-palette.ts");
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("fails naming the untracked file the staged one imports", () => {
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('components/board-palette.ts imports "@/lib/achievement-replay" → lib/achievement-replay.ts');
    expect(r.stderr).toContain("git add lib/achievement-replay.ts");
  });

  it("passes once the imported file is staged too", () => {
    git("add", "lib/achievement-replay.ts");
    expect(check().status).toBe(0);
  });
});
