import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheComponentsOn, type Problem, prerenderFacts, prerenderProblems, prerenderReport, treeProblems } from "./prerender-check";

describe("Weft's routes", () => {
  // The real tree: what `next build` refuses under cacheComponents and nothing else catches (2026-10-17: two
  // production deploys of app/s/[id]/page.tsx, 14 minutes each).
  it("build under cacheComponents", () => {
    const root = path.resolve(__dirname, "..");
    expect(cacheComponentsOn(root)).toBe(true);
    expect(prerenderReport(treeProblems(root))).toBe("");
  }, 60_000);
});

describe("prerenderFacts", () => {
  it("finds segment config exports, declared or re-exported", () => {
    const src = ['export const dynamic = "force-dynamic";', "export const revalidate = 60, other = 1;", "const fetchCache = 'x';", "export { fetchCache };", "export let dynamicParams = false;", "const runtime = 1;", "export const [a] = [1];", "export const runtime2 = runtime;"].join("\n");
    expect(prerenderFacts(src, "page.tsx").segmentConfigs).toEqual(["dynamic", "revalidate", "fetchCache", "dynamicParams"]);
  });

  it("ignores ones in comments, strings and unexported", () => {
    const src = ['// export const dynamic = "force-dynamic";', 'const s = "export const revalidate = 1";', "const dynamic = 1;"].join("\n");
    expect(prerenderFacts(src, "page.ts").segmentConfigs).toEqual([]);
  });

  it("reads awaits in a default export function", () => {
    const src = "export default async function Page({ params, searchParams }) { const { id } = await params; await searchParams; return <p/>; }";
    expect(prerenderFacts(src, "page.tsx").reads).toEqual([
      { fn: "the default export", what: "params" },
      { fn: "the default export", what: "searchParams" },
    ]);
  });

  it("reads props.params, (await cookies()) and headers()", () => {
    const src = 'import { cookies, headers } from "next/headers";\nexport default async function (props) { await props.params; (await cookies()).get("a"); await (headers()); await other(); await props.x; await x.y(); return null; }';
    expect(prerenderFacts(src, "page.tsx").reads.map((r) => r.what)).toEqual(["params", "cookies()", "headers()"]);
  });

  it("follows `export default Name` to a function or a const arrow", () => {
    expect(prerenderFacts("async function Page({ params }) { await params; }\nexport default Page;", "page.tsx").reads).toHaveLength(1);
    expect(prerenderFacts("const Page = async ({ params }) => { await params; };\nexport default Page;", "page.tsx").reads).toHaveLength(1);
    expect(prerenderFacts("export default (async ({ params }) => { await params; });", "page.tsx").reads).toHaveLength(1);
    expect(prerenderFacts("export default async function ({ params }) { await params; }", "page.tsx").reads).toHaveLength(1);
    expect(prerenderFacts("async function P({ params }) { await params; }\nexport { P as default };", "page.tsx").reads).toHaveLength(1);
    expect(prerenderFacts('export { dynamic } from "./config";\nexport * from "./x";', "page.tsx").segmentConfigs).toEqual([]);
    expect(prerenderFacts("export default Missing;", "page.tsx").reads).toEqual([]);
    expect(prerenderFacts("export default 1;", "page.tsx").reads).toEqual([]);
    expect(prerenderFacts("const Page = 1;\nexport default Page;", "page.tsx").reads).toEqual([]);
  });

  it("reads generateMetadata and generateViewport, declared or exported by name", () => {
    const src = ["export async function generateMetadata({ params }) { await params; }", "const generateViewport = async () => { await headers(); };", "export { generateViewport };", "export async function other({ params }) { await params; }"].join("\n");
    expect(prerenderFacts(src, "page.tsx").reads).toEqual([
      { fn: "generateMetadata", what: "params" },
      { fn: "generateViewport", what: "headers()" },
    ]);
  });

  it("skips awaits inside nested functions and bodyless declarations", () => {
    const src = "export default async function Page({ params }) { const f = async () => await params; async function g() { await cookies(); } return f; }\nexport declare function generateMetadata(): void;";
    expect(prerenderFacts(src, "page.ts").reads).toEqual([]);
  });

  it("lets a \"use cache\" function await params, not cookies", () => {
    const src = 'export default async function Page({ params }) { "use cache"; await params; await cookies(); }';
    expect(prerenderFacts(src, "page.ts").reads.map((r) => r.what)).toEqual(["cookies()"]);
    expect(prerenderFacts("export default async ({ params }) => await params;", "page.ts").reads).toHaveLength(1);
  });

  it("knows generateStaticParams", () => {
    expect(prerenderFacts("export async function generateStaticParams() { return [{}]; }", "page.ts").staticParams).toBe(true);
    expect(prerenderFacts("export const generateStaticParams = () => [];", "page.ts").staticParams).toBe(true);
    expect(prerenderFacts("async function generateStaticParams() {}", "page.ts").staticParams).toBe(false);
  });

  it("knows a layout that renders its children inside <Suspense>", () => {
    const yes = (src: string) => prerenderFacts(src, "layout.tsx").suspendsChildren;
    expect(yes("export default ({ children }) => <Suspense><Shell>{children}</Shell></Suspense>;")).toBe(true);
    expect(yes("export default (props) => <React.Suspense>{props.children}</React.Suspense>;")).toBe(true);
    expect(yes("export default ({ children }) => <main><Suspense><Nav/></Suspense>{children}</main>;")).toBe(false);
    expect(yes("export default (p) => <Suspense>{p.x.children}</Suspense>;")).toBe(true);
    expect(yes("export default (p) => <Suspense>{children.x}</Suspense>;")).toBe(true); // a heuristic: any children inside
    expect(yes("export default (p) => <Suspense>{p.childrenX}</Suspense>;")).toBe(false);
    expect(yes("export default (p) => <Suspense />;")).toBe(false);
  });
});

describe("prerenderFacts clock", () => {
  const clock = (src: string) => prerenderFacts(src, "page.tsx").clock;

  it("names a function that builds a service client before anything request-bound", () => {
    expect(clock("async function Body() { const s = serviceClient(); await webUser(); }")).toEqual(["Body"]);
    expect(clock("const Body = async () => { if (!serviceClient()) return null; };")).toEqual(["Body"]);
  });

  it("lets connection(), webClient() or webUser() come first", () => {
    expect(clock("async function A() { await connection(); serviceClient(); }")).toEqual([]);
    expect(clock("async function B() { const u = await webUser(); serviceClient(); }")).toEqual([]);
    expect(clock("async function C() { const c = await webClient(); serviceClient(); }")).toEqual([]);
  });

  it("skips nested functions, other calls, method calls and bodyless declarations", () => {
    expect(clock("async function A() { const f = () => serviceClient(); await connection(); }")).toEqual([]);
    expect(clock("async function B() { other(); x.serviceClient(); }")).toEqual([]);
    expect(clock("declare function D(): void;")).toEqual([]);
  });
});

describe("prerenderProblems and treeProblems", () => {
  let root: string;
  const write = (files: Record<string, string>) => {
    for (const [rel, src] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), src);
    }
  };
  const problems = (rel: string, src?: string) => prerenderProblems(root, path.join(root, rel), src);
  const AWAITS = "export default async function Page({ params }) { await params; return null; }";
  const only = (list: Problem[]): Problem => {
    expect(list).toHaveLength(1);
    return list[0] as Problem;
  };

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "prerender-")));
    write({ "next.config.ts": "export default { cacheComponents: true };" });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("names a segment config as a config problem, in pages and route handlers", () => {
    const p = only(problems("app/s/page.tsx", 'export const dynamic = "force-dynamic";'));
    expect(p.kind).toBe("config");
    expect(p.message).toContain('app/s/page.tsx exports `dynamic`: "Route segment config "dynamic" is not compatible');
    expect(problems("app/api/x/route.ts", "export const revalidate = 0; export async function GET({ params }) { await params; }").map((x) => x.kind)).toEqual(["config"]);
  });

  it("names an awaited read outside <Suspense> as blocking, with its fix", () => {
    const p = only(problems("app/s/[id]/page.tsx", AWAITS));
    expect(p.kind).toBe("blocking");
    expect(p.message).toContain("app/s/[id]/page.tsx: the default export awaits params outside <Suspense>");
    expect(p.message).toContain("PageBody");
    const m = only(problems("app/page.tsx", "export async function generateMetadata() { await cookies(); }"));
    expect(m.message).toContain("generateMetadata awaits cookies() outside <Suspense>");
    expect(m.message).toContain("make the metadata static");
  });

  it("names metadata read ahead of the page's static gate as blocking, once, with its fix (the 0.7.1 dmg build)", () => {
    const src = 'export default function Page({ params }) { if (!isWebEnabled()) return <NotDeployed />; return <Suspense><Body params={params} /></Suspense>; }\nexport async function generateMetadata({ params }) { await params; }';
    const p = only(problems("app/s/[id]/page.tsx", src));
    expect(p.kind).toBe("blocking");
    expect(p.message).toContain("app/s/[id]/page.tsx: generateMetadata reads params before returning on `!isWebEnabled()`");
    expect(p.message).toContain("linkPreview");
  });

  it("names a service client built before connection() as blocking, even inside <Suspense>", () => {
    const src = "async function Body() { serviceClient(); }\nexport default function Page() { return <Suspense><Body /></Suspense>; }";
    const p = only(problems("app/s/[id]/page.tsx", src));
    expect(p.kind).toBe("blocking");
    expect(p.message).toContain("app/s/[id]/page.tsx: Body calls serviceClient() before anything request-bound");
    expect(p.message).toContain("await connection()");
    expect(problems("app/api/x/route.ts", "export async function GET() { serviceClient(); }")).toEqual([]);
  });

  it("reads the file from disk without a source, and lets generateStaticParams await params", () => {
    write({ "app/a/page.tsx": AWAITS, "app/b/page.tsx": `${AWAITS}\nexport function generateStaticParams() { return [{}]; }` });
    expect(problems("app/a/page.tsx")).toHaveLength(1);
    expect(problems("app/b/page.tsx")).toEqual([]);
    expect(problems("app/missing/page.tsx")).toEqual([]);
  });

  it("only checks pages, layouts and route handlers under app/ or src/app/", () => {
    expect(problems("app/home/Hero.tsx", AWAITS)).toEqual([]);
    expect(problems("lib/page.tsx", AWAITS)).toEqual([]);
    expect(problems("app/api/x/route.tsx", "export const dynamic = 1;")).toEqual([]);
    expect(problems("src/app/page.tsx", AWAITS)).toHaveLength(1);
  });

  it("lets a page under a layout that wraps its children in <Suspense>, or beside a loading.tsx, await", () => {
    write({ "app/[org]/layout.tsx": "export default ({ children }) => <Suspense>{children}</Suspense>;", "app/x/loading.tsx": "export default () => null;" });
    expect(problems("app/[org]/board/page.tsx", AWAITS)).toEqual([]);
    expect(problems("app/[org]/page.tsx", AWAITS)).toEqual([]);
    expect(problems("app/x/page.tsx", AWAITS)).toEqual([]);
    expect(problems("app/x/y/page.tsx", AWAITS)).toEqual([]);
    // generateMetadata sits outside every boundary.
    expect(problems("app/[org]/page.tsx", "export async function generateMetadata({ params }) { await params; }")).toHaveLength(1);
  });

  it("doesn't let a layout cover itself or count its own loading.tsx", () => {
    write({ "app/x/loading.tsx": "export default () => null;", "app/z/layout.tsx": "export default () => null;" });
    const layout = "export default async function L({ params, children }) { await params; return <Suspense>{children}</Suspense>; }";
    write({ "app/w/layout.tsx": layout });
    expect(problems("app/x/layout.tsx", AWAITS)).toHaveLength(1);
    expect(problems("app/w/layout.tsx")).toHaveLength(1);
    expect(problems("app/w/page.tsx", AWAITS)).toEqual([]);
    expect(problems("app/z/page.tsx", AWAITS)).toHaveLength(1);
    expect(problems("app/x/y/layout.tsx", AWAITS)).toEqual([]);
  });

  it("walks the whole tree, sorted, skipping dot-folders and node_modules", () => {
    write({ "app/b/page.tsx": AWAITS, "app/a/route.ts": "export const dynamic = 1;", "app/.x/page.tsx": AWAITS, "app/node_modules/page.tsx": AWAITS, "app/a/Other.tsx": AWAITS });
    expect(treeProblems(root).map((p) => p.message.split(" ")[0])).toEqual(["app/a/route.ts", "app/b/page.tsx:"]);
  });

  it("checks nothing when cacheComponents is off", () => {
    write({ "next.config.ts": "export default { cacheComponents: false };", "app/page.tsx": AWAITS });
    expect(cacheComponentsOn(root)).toBe(false);
    expect(treeProblems(root)).toEqual([]);
    fs.rmSync(path.join(root, "next.config.ts"));
    write({ "next.config.mjs": "export default { cacheComponents: true }" });
    expect(cacheComponentsOn(root)).toBe(true);
  });
});

describe("prerenderReport", () => {
  it("is empty when clean, else a list", () => {
    expect(prerenderReport([])).toBe("");
    expect(prerenderReport([{ kind: "config", message: "a" }])).toBe("`next build` will refuse these under cacheComponents (a failed deploy):\n- a");
  });
});
