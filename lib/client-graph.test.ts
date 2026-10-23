import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientLeaks, leakReport, moduleFacts, sourceFiles } from "./client-graph";

describe("the board's client code", () => {
  // The real tree: a "use client" file that reaches "use cache", cacheLife/cacheTag or "server-only" fails the
  // build before React runs (2026-10-17: lib/share-types.ts → lib/home.ts → … → lib/home-release.ts).
  it("never reaches a server-only module", () => {
    const root = path.resolve(__dirname, "..");
    expect(leakReport(clientLeaks(root, ["components", "lib", "app"]))).toBe("");
  }, 60_000);
});

describe("moduleFacts", () => {
  it("reads the prologue's directives, not later strings", () => {
    expect(moduleFacts('// note\n"use client";\n"use strict";\nconst a = 1;\n"use server";', "a.tsx").directives).toEqual(["use client", "use strict"]);
    expect(moduleFacts("const a = 1;", "a.ts").directives).toEqual([]);
  });

  it("lists value imports, static, re-exported and dynamic", () => {
    const src = [
      'import a from "./default";',
      'import * as ns from "./namespace";',
      'import { b, type C } from "./mixed";',
      'import d, { type E } from "./default-and-type";',
      'import "./side-effect";',
      'import {} from "./empty";',
      'export * from "./star";',
      'export { f } from "./reexport";',
      'export { g, type H } from "./reexport-mixed";',
      "export { a };",
      'const lazy = () => import("./dynamic");',
      "const tpl = () => import(`./template`);",
      "const computed = (x: string) => import(x);",
      "const noArg = () => import();",
      'export * as ns from "./ns-export";',
      'export {} from "./empty-export";',
      'call("./not-an-import");',
    ].join("\n");
    expect(moduleFacts(src, "a.ts").imports).toEqual([
      "./default",
      "./namespace",
      "./mixed",
      "./default-and-type",
      "./side-effect",
      "./empty",
      "./star",
      "./reexport",
      "./reexport-mixed",
      "./dynamic",
      "./template",
      "./ns-export",
      "./empty-export",
    ]);
  });

  it("skips imports and re-exports erased as types", () => {
    const src = [
      'import type { A } from "./a";',
      'import type B from "./b";',
      'import { type C, type D } from "./c";',
      'export type { E } from "./e";',
      'export type * from "./f";',
      'export { type G } from "./g";',
      'import type { cacheLife } from "next/cache";',
      'import type {} from "server-only";',
    ].join("\n");
    expect(moduleFacts(src, "a.ts")).toEqual({ directives: [], imports: [], serverOnly: [] });
  });

  it("names why a module is server-only", () => {
    const src = [
      'import "server-only";',
      'import { revalidatePath, cacheLife as life, type cacheTag } from "next/cache";',
      'import * as cache from "next/cache";',
      'import next from "next/cache";',
      'import { unstable_cacheTag } from "next/cache";',
      "export async function a() {",
      '  "use cache";',
      "  life('hours');",
      "}",
      "async function b() {",
      '  "use cache: remote";',
      "}",
      "async function c() {",
      '  "use cache";',
      "}",
      '"use caches";',
    ].join("\n");
    expect(moduleFacts(src, "a.ts").serverOnly).toEqual([
      'imports "server-only"',
      'imports cacheLife from "next/cache"',
      'imports unstable_cacheTag from "next/cache"',
      'has a "use cache" directive',
      'has a "use cache: remote" directive',
    ]);
  });

  it("ignores directives and imports that only appear in comments and strings", () => {
    const src = '// "use cache"\n/* import("./x") */\nconst s = \'"use cache"; import "server-only"\';\nconst t = "<div>use cache</div>";';
    expect(moduleFacts(src, "a.tsx")).toEqual({ directives: [], imports: [], serverOnly: [] });
  });

  it("survives a half-written file", () => {
    expect(moduleFacts('import x from y;\nexport * from z;\nimport { a } from "./ok";', "a.ts").imports).toEqual(["./ok"]);
  });

  it("parses JSX in .tsx and type assertions in .ts", () => {
    expect(moduleFacts('const a = <b>{import("./x")}</b>;', "a.tsx").imports).toEqual(["./x"]);
    expect(moduleFacts('const a = <string>(import("./y") as unknown);', "a.ts").imports).toEqual(["./y"]);
  });
});

describe("clientLeaks", () => {
  let root: string;

  function write(files: Record<string, string>) {
    for (const [rel, src] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), src);
    }
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "client-graph-")));
    write({ "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }) });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("prints the chain from a client component to the server-only module (today's bug, in small)", () => {
    write({
      "components/ShareCardDialog.tsx": '"use client";\nimport { SITE } from "@/lib/share-types";',
      "lib/share-types.ts": 'import { SITE } from "./home";\nexport { SITE };',
      "lib/home.ts": 'export const SITE = "x";\nexport const load = () => import("@/components/home/Home");',
      "components/home/Home.tsx": 'import { latest } from "@/lib/home-release";\nexport default function Home() { return latest; }',
      "lib/home-release.ts": 'import { cacheLife } from "next/cache";\nexport async function latest() {\n  "use cache";\n  cacheLife("hours");\n}',
    });
    const leaks = clientLeaks(root, ["components", "lib"]);
    expect(leaks).toEqual([
      {
        chain: ["components/ShareCardDialog.tsx", "lib/share-types.ts", "lib/home.ts", "components/home/Home.tsx", "lib/home-release.ts"],
        serverOnly: ['imports cacheLife from "next/cache"', 'has a "use cache" directive'],
      },
    ]);
    expect(leakReport(leaks)).toBe(
      [
        "Client code reaches server-only modules, so Next won't build the board:",
        '- components/ShareCardDialog.tsx → lib/share-types.ts → lib/home.ts → components/home/Home.tsx → lib/home-release.ts (imports cacheLife from "next/cache", has a "use cache" directive)',
        "Break the chain: move what the client needs into a module of its own (as lib/site.ts holds SITE for lib/home.ts).",
      ].join("\n"),
    );
  });

  it("reports a client file that is server-only itself, and each server-only module once", () => {
    write({
      "app/a/Bad.tsx": '"use client";\nimport "server-only";',
      "app/b/One.tsx": '"use client";\nimport "../../lib/secret";',
      "app/b/Two.tsx": '"use client";\nimport "@/lib/secret";',
      "lib/secret.ts": 'import "server-only";',
    });
    expect(clientLeaks(root, ["app"])).toEqual([
      { chain: ["app/a/Bad.tsx"], serverOnly: ['imports "server-only"'] },
      { chain: ["app/b/One.tsx", "lib/secret.ts"], serverOnly: ['imports "server-only"'] },
    ]);
  });

  // 2026-10-24: a client component imported lib/model-limit.ts, which reads ~/.weft off disk. Turbopack
  // panicked on node:fs and the board route 500'd with nothing the UI could show.
  it("reports a client file that reaches a Node built-in", () => {
    write({
      "components/Picker.tsx": '"use client";\nimport { limited } from "@/lib/limits";',
      "lib/limits.ts": 'import fs from "node:fs";\nimport path from "node:path";\nexport const limited = () => fs.readFileSync(path.join("/tmp", "x"), "utf8");',
    });
    expect(clientLeaks(root, ["components"])).toEqual([
      { chain: ["components/Picker.tsx", "lib/limits.ts"], serverOnly: ['imports "node:fs"', 'imports "node:path"'] },
    ]);
  });

  it("passes a client file that reaches a Node built-in only as a type", () => {
    write({
      "components/Picker.tsx": '"use client";\nimport type { Stats } from "node:fs";',
    });
    expect(clientLeaks(root, ["components"])).toEqual([]);
  });

  it("passes server components, type imports, server actions, packages and missing or non-source files", () => {
    write({
      "components/Server.tsx": 'import "@/lib/cached";',
      "components/Client.tsx": [
        '"use client";',
        'import type { T } from "@/lib/cached";',
        'import { act } from "@/lib/actions";',
        'import { useState } from "react";',
        'import "./Client.css";',
        'import data from "./data.json";',
        'import "./missing";',
        'import { ok } from "./ok";',
        'import { ok as again } from "./ok";',
      ].join("\n"),
      "components/Client.css": "a {}",
      "components/data.json": "{}",
      "components/ok/index.ts": 'export const ok = 1;\nexport { act } from "@/lib/actions";',
      "lib/actions.ts": '"use server";\nimport "server-only";\nimport "./cached";',
      "lib/cached.ts": 'export async function c() {\n  "use cache";\n}',
    });
    expect(clientLeaks(root, ["components", "lib"])).toEqual([]);
    expect(leakReport([])).toBe("");
  });
});

describe("sourceFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "source-files-")));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("lists source files, sorted, without node_modules, dot-folders or other files", () => {
    for (const rel of ["b.tsx", "a/z.mjs", "a/y.cjs", "a/x.js", "c.ts", "d.css", "e.md", "node_modules/p/i.ts", ".next/s.js", "f/.hidden.ts"]) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), "");
    }
    expect(sourceFiles(dir).map((f) => path.relative(dir, f))).toEqual(["a/x.js", "a/y.cjs", "a/z.mjs", "b.tsx", "c.ts"]);
  });
});
