import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { moduleFacts, sourceFiles } from "./client-graph";
import { _resetLoadHomeCacheForTests, loadHome } from "./home-loader";
import { resolveSpec } from "./import-check";

describe("loadHome", () => {
  // loadHome caches its first successful import at module scope, so each test must reset it to a clean slate.
  beforeEach(() => _resetLoadHomeCacheForTests());

  const stub = () => null;

  it("resolves the default export of the importer", async () => {
    const result = await loadHome(() => Promise.resolve({ default: stub }));
    expect("Home" in result).toBe(true);
    if ("Home" in result) expect(result.Home).toBe(stub);
  });

  it("caches the resolved component across calls so it imports once", async () => {
    let calls = 0;
    const importer = () => {
      calls += 1;
      return Promise.resolve({ default: stub });
    };
    const a = await loadHome(importer);
    const b = await loadHome(importer);
    expect(calls).toBe(1);
    expect("Home" in a && "Home" in b).toBe(true);
  });

  it("returns an error result with the file and first message line when the import throws", async () => {
    // The shape Next's dev overlay shows for a parse error: a multi-line message with the file on the first line.
    const importer = () =>
      Promise.reject(
        new Error(
          "./components/home/Home.tsx:64:1\nUnexpected token. Did you mean `{'}'}` or `&rbrace;`?\nParsing ecmascript source code failed",
        ),
      );
    const result = await loadHome(importer);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.file).toBe("components/home/Home.tsx");
      expect(result.error.message).toBe("./components/home/Home.tsx:64:1");
    }
  });

  it("returns a file-less error for a thrown non-Error", async () => {
    // A bare string is what's under test: some bundler errors reach us that way.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const result = await loadHome(() => Promise.reject("boom"));
    expect(result).toEqual({ error: { message: "boom", file: null } });
  });

  it("returns an error when the module has no default export", async () => {
    const importer = () => Promise.resolve({ default: undefined }) as unknown as Promise<{ default: () => null }>;
    const result = await loadHome(importer);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.message).toMatch(/no default export/);
      expect(result.error.file).toBeNull();
    }
  });
});

// On 2026-11-12 a stylesheet the home-page redesign hadn't written yet 500'd /api/cards and Weft wouldn't start:
// lib/analytics-server.ts imported lib/home.ts, whose loadHome() imported components/home/Home. Turbopack resolves a
// dynamic import()'s graph at build time, so any route that can reach the home page breaks with it. Only the two page
// routes may; this walks every app/api route and instrumentation.ts and fails with the chain if one reaches it.
describe("the server's routes don't reach the home page", () => {
  const root = path.resolve(__dirname, "..");
  const HOME = path.join(root, "components", "home") + path.sep;

  function chainToHome(): string[] | null {
    const starts = [...sourceFiles(path.join(root, "app", "api")).filter((f) => /route\.tsx?$/.test(f)), path.join(root, "instrumentation.ts")];
    const from = new Map<string, string | null>(starts.map((f) => [f, null]));
    const queue = [...starts];
    for (const file of queue) {
      if (file.startsWith(HOME)) {
        const chain: string[] = [];
        for (let at: string | null | undefined = file; at; at = from.get(at)) chain.unshift(path.relative(root, at));
        return chain;
      }
      for (const spec of moduleFacts(fs.readFileSync(file, "utf8"), file).imports) {
        const target = resolveSpec(root, file, spec);
        if (!target || !/\.[cm]?[jt]sx?$/.test(target) || from.has(target)) continue;
        from.set(target, file);
        queue.push(target);
      }
    }
    return null;
  }

  it("no app/api route or instrumentation.ts imports components/home, even dynamically", () => {
    const chain = chainToHome();
    expect(chain, chain ? `Reaches the home page: ${chain.join(" → ")}. Import loadHome from lib/home-loader.ts only in a page.` : "").toBeNull();
  });
});
