import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { RUNTIME_PROPS, type UngatedRead, ungatedMessage, ungatedMetadata } from "./prerender-gate";

// Finds what `next build` refuses under cacheComponents (next.config.ts) and nothing else catches: pnpm test, lint,
// typecheck and `next dev` all pass, then the Vercel build fails. The admin pages' force-dynamic failed it on
// 2026-10-16 (f8aa47f), and two production deploys of app/s/[id]/page.tsx on 2026-10-17 (14 minutes each):
// `export const dynamic = "force-dynamic"` (88e1ff1), then `await params` in the page's default export before its
// <Suspense> (fcc13a8). Two checks on app/**/page|layout:
// - a route segment config export (dynamic, revalidate, fetchCache, dynamicParams), also in route.ts: a build error;
// - runtime data (`await params`/`searchParams`, `await cookies()`/`headers()`) awaited directly in the default export
//   or in generateMetadata/generateViewport, outside any <Suspense>: "uncached or runtime data during prerendering".
//   A heuristic: awaits inside a helper the page calls aren't seen.
// - a page or layout function that calls serviceClient() before connection(), webClient() or webUser() (both await
//   connection()): supabase-js reads Date.now() as it builds the client, "encountered the unstable value Date.now()
//   while prerendering". Not a build error: it fires on a cold lambda only (the client is cached after), and left
//   /invite/[token] on its fallback on 2026-10-18. <Suspense> doesn't help; only connection() does.
// - a page whose default export returns a static branch on an env gate before its <Suspense>, while generateMetadata
//   reads params without returning on that gate first: the Mac release build (no VERCEL/WEFT_WEB) refused five share
//   pages on 2026-11-03 and kept 0.7.1 from packing (lib/prerender-gate.ts).
// lib/prerender-check.test.ts runs it over the real tree; lib/route-import-guard.ts runs it on each edit to a route
// file. The TypeScript parser, so comments and strings that mention these never count. Only node: imports and
// typescript: scripts/import-check-hook.mjs loads this file with Node's type stripping.
// See node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md.

const SEGMENT_CONFIGS = new Set(["dynamic", "revalidate", "fetchCache", "dynamicParams"]);
// Not connection(): app/(admin)/admin/settings/page.tsx awaits it at the top and builds (it marks a route dynamic on purpose).
const RUNTIME_CALLS = new Set(["cookies", "headers"]);
// Builds a Supabase client (Date.now()) / moves the render past the prerender (connection(), or a helper awaiting it).
const CLOCK_CALLS = new Set(["serviceClient"]);
const REQUEST_BOUND = new Set(["connection", "webClient", "webUser"]);
const METADATA_FNS = new Set(["generateMetadata", "generateViewport"]);
const RENDER_FILE = /^(?:page|layout)\.[jt]sx?$/;
const ROUTE_HANDLER = /^route\.[jt]s$/;
const NEXT_CONFIGS = ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs"];

export interface Problem {
  // "config" is a certain build error; "blocking" is the heuristic.
  kind: "config" | "blocking";
  message: string;
}

// One awaited runtime read: which function awaits it and what it reads ("params", "cookies()").
interface Read {
  fn: string;
  what: string;
}

export interface PrerenderFacts {
  segmentConfigs: string[];
  // Exports generateStaticParams: awaiting params outside <Suspense> keeps ISR for unlisted paths, on purpose.
  staticParams: boolean;
  // Renders `children` inside a <Suspense>: every page below this layout is inside a boundary.
  suspendsChildren: boolean;
  reads: Read[];
  // The functions that build a service client before anything request-bound.
  clock: string[];
  // Metadata functions that read params ahead of the gate the page's static branch returns on.
  ungated: UngatedRead[];
}

export function prerenderFacts(src: string, file: string): PrerenderFacts {
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const top = topLevel(sf);
  const reads: Read[] = [];
  const metas: [string, ts.FunctionLikeDeclaration][] = [];
  for (const [name, target] of top.exported) {
    if (name !== "default" && !METADATA_FNS.has(name)) continue;
    const fn = typeof target === "string" ? top.fns.get(target) : target;
    if (fn) reads.push(...runtimeReads(fn).map((what) => ({ fn: name === "default" ? "the default export" : name, what })));
    if (fn && name !== "default") metas.push([name, fn]);
  }
  const page = top.exported.get("default");
  const ungated = ungatedMetadata(typeof page === "string" ? top.fns.get(page) : page, metas, top.fns);
  const clock = [...top.fns].filter(([, fn]) => clockFirst(fn)).map(([name]) => name);
  return { segmentConfigs: top.segmentConfigs, staticParams: top.exported.has("generateStaticParams"), suspendsChildren: suspendsChildren(sf), reads, clock, ungated };
}

// A module's top level: its segment config exports, its functions by name, and what it exports, each as the function
// itself or the name of the local it exports ("default" for the default export).
interface TopLevel {
  segmentConfigs: string[];
  fns: Map<string, ts.FunctionLikeDeclaration>;
  exported: Map<string, ts.FunctionLikeDeclaration | string>;
}

function topLevel(sf: ts.SourceFile): TopLevel {
  const top: TopLevel = { segmentConfigs: [], fns: new Map(), exported: new Map() };
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s)) addFunction(top, s);
    else if (ts.isVariableStatement(s)) addVariables(top, s);
    else if (ts.isExportAssignment(s) && !s.isExportEquals) {
      top.exported.set("default", functionOf(s.expression) ?? (ts.isIdentifier(s.expression) ? s.expression.text : ""));
    } else if (ts.isExportDeclaration(s)) addExportList(top, s);
  }
  return top;
}

function addFunction(top: TopLevel, s: ts.FunctionDeclaration) {
  if (s.name) top.fns.set(s.name.text, s);
  if (isDefault(s)) top.exported.set("default", s);
  else if (s.name && isExported(s)) top.exported.set(s.name.text, s);
}

// `const Page = async () => …`, and `export const dynamic = …`.
function addVariables(top: TopLevel, s: ts.VariableStatement) {
  for (const d of s.declarationList.declarations) {
    if (!ts.isIdentifier(d.name)) continue;
    const fn = d.initializer && functionOf(d.initializer);
    if (fn) top.fns.set(d.name.text, fn);
    if (!isExported(s)) continue;
    if (SEGMENT_CONFIGS.has(d.name.text)) top.segmentConfigs.push(d.name.text);
    top.exported.set(d.name.text, fn ?? d.name.text);
  }
}

// `export { dynamic, Page as default }`, not a re-export from another module.
function addExportList(top: TopLevel, s: ts.ExportDeclaration) {
  if (s.moduleSpecifier || !s.exportClause || !ts.isNamedExports(s.exportClause)) return;
  for (const e of s.exportClause.elements) {
    if (SEGMENT_CONFIGS.has(e.name.text)) top.segmentConfigs.push(e.name.text);
    top.exported.set(e.name.text, (e.propertyName ?? e.name).text);
  }
}

function modifiers(node: ts.Node): ts.SyntaxKind[] {
  return ((ts.canHaveModifiers(node) && ts.getModifiers(node)) || []).map((m) => m.kind);
}

const isExported = (node: ts.Node) => modifiers(node).includes(ts.SyntaxKind.ExportKeyword);
const isDefault = (node: ts.Node) => modifiers(node).includes(ts.SyntaxKind.DefaultKeyword);

// The function an expression is, through parentheses: `async () => …`, `function () {}`. Null for anything else.
function functionOf(node: ts.Expression): ts.FunctionLikeDeclaration | null {
  const e = ts.skipPartiallyEmittedExpressions(ts.isParenthesizedExpression(node) ? node.expression : node);
  return ts.isArrowFunction(e) || ts.isFunctionExpression(e) ? e : null;
}

// What a function awaits at its own level (not in functions nested in it), minus what its "use cache" makes a cache
// key: inside a cached function params and searchParams are fine.
function runtimeReads(fn: ts.FunctionLikeDeclaration): string[] {
  const body = fn.body;
  if (!body) return [];
  const cached = ts.isBlock(body) && body.statements.some((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && /^use cache(:|$)/.test(s.expression.text));
  const reads: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isAwaitExpression(node)) {
      const what = readOf(node.expression);
      if (what && !(cached && RUNTIME_PROPS.has(what))) reads.push(what);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return reads;
}

// Whether a function's own body (not functions nested in it) calls serviceClient() before connection(), webClient()
// or webUser(), in source order.
function clockFirst(fn: ts.FunctionLikeDeclaration): boolean {
  const seen: { first?: string } = {};
  const visit = (node: ts.Node) => {
    if (seen.first || ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (CLOCK_CALLS.has(name) || REQUEST_BOUND.has(name)) seen.first = name;
    }
    if (!seen.first) ts.forEachChild(node, visit);
  };
  if (fn.body) ts.forEachChild(fn.body, visit);
  return !!seen.first && CLOCK_CALLS.has(seen.first);
}

// `params`, `props.params`, `cookies()`: the runtime data an awaited expression is, or null.
function readOf(node: ts.Expression): string | null {
  const e = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isIdentifier(e) && RUNTIME_PROPS.has(e.text)) return e.text;
  if (ts.isPropertyAccessExpression(e) && RUNTIME_PROPS.has(e.name.text)) return e.name.text;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && RUNTIME_CALLS.has(e.expression.text)) return `${e.expression.text}()`;
  return null;
}

// A <Suspense> (or <React.Suspense>) anywhere in the file with `children` or `x.children` inside it.
function suspendsChildren(sf: ts.SourceFile): boolean {
  let found = false;
  // `x.children`'s name is an Identifier too.
  const hasChildren = (node: ts.Node): boolean => (ts.isIdentifier(node) && node.text === "children") || !!ts.forEachChild(node, (c) => hasChildren(c) || undefined);
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(node) && /^(React\.)?Suspense$/.test(node.openingElement.tagName.getText(sf)) && hasChildren(node)) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// Whether the project's next.config turns cacheComponents on; these checks mean nothing without it.
export function cacheComponentsOn(root: string): boolean {
  return NEXT_CONFIGS.some((name) => /\bcacheComponents\s*:\s*true\b/.test(readText(path.join(root, name)) ?? ""));
}

// Whether a page or layout already renders inside a <Suspense> from above: a loading.tsx beside the page or in a
// folder above (a layout's own loading.tsx wraps its page, not it), or a layout above that wraps its children.
function insideSuspense(appDir: string, file: string): boolean {
  const isPage = /^page\./.test(path.basename(file));
  for (let dir = path.dirname(file); dir.startsWith(appDir); dir = path.dirname(dir)) {
    const own = dir === path.dirname(file);
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (/^loading\.[jt]sx?$/.test(name) && (isPage || !own)) return true;
      if (/^layout\.[jt]sx?$/.test(name) && (isPage || !own) && path.join(dir, name) !== file) {
        if (prerenderFacts(readText(path.join(dir, name)) ?? "", name).suspendsChildren) return true;
      }
    }
    if (dir === appDir) break;
  }
  return false;
}

// The app/ folder a file is in (app/ or src/app/ under root), or null.
function appDirOf(root: string, file: string): string | null {
  for (const dir of [path.join(root, "app"), path.join(root, "src", "app")]) {
    if (file.startsWith(dir + path.sep)) return dir;
  }
  return null;
}

// What `next build` would refuse in one file, given its source (the text after an edit) or what's on disk.
// Empty for files outside app/ and for anything that isn't a page, layout or route handler.
export function prerenderProblems(root: string, file: string, src?: string): Problem[] {
  const appDir = appDirOf(root, file);
  const base = path.basename(file);
  const render = RENDER_FILE.test(base);
  if (!appDir || !(render || ROUTE_HANDLER.test(base))) return [];
  const facts = prerenderFacts(src ?? readText(file) ?? "", file);
  const rel = path.relative(root, file).split(path.sep).join("/");
  const problems: Problem[] = facts.segmentConfigs.map((name) => ({
    kind: "config",
    message: `${rel} exports \`${name}\`: "Route segment config "${name}" is not compatible with nextConfig.cacheComponents". Delete it (runtime data already renders per request; cache with "use cache" + cacheLife instead of revalidate).`,
  }));
  if (!render) return problems;
  for (const fn of facts.clock) {
    problems.push({ kind: "blocking", message: `${rel}: ${fn} calls serviceClient() before anything request-bound: "Next.js encountered the unstable value \`Date.now()\` while prerendering" on a cold start. \`await connection()\` (next/server) first, as app/invite/[token]/page.tsx's InviteBody does.` });
  }
  for (const u of facts.ungated) problems.push({ kind: "blocking", message: ungatedMessage(rel, u) });
  // An ungated metadata function's own message says how to fix it; "use cache" on params alone wouldn't.
  const reads = facts.reads.filter((r) => !(r.what === "params" && facts.staticParams) && !facts.ungated.some((u) => u.fn === r.fn));
  const pageReads = reads.filter((r) => r.fn === "the default export");
  const covered = pageReads.length > 0 && insideSuspense(appDir, file);
  for (const r of covered ? reads.filter((x) => x.fn !== "the default export") : reads) {
    const fix =
      r.fn === "the default export"
        ? "Pass the promise into a component rendered inside <Suspense> and await it there (as app/s/[id]/page.tsx's PageBody does)."
        : "generateMetadata can't sit in <Suspense>: make the metadata static, or \"use cache\" it on params alone.";
    problems.push({ kind: "blocking", message: `${rel}: ${r.fn} awaits ${r.what} outside <Suspense>: "Next.js encountered uncached or runtime data during prerendering". ${fix}` });
  }
  return problems;
}

// Every page, layout and route handler under app/ (and src/app/), sorted, skipping dot-folders and node_modules.
function routeFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (RENDER_FILE.test(entry.name) || ROUTE_HANDLER.test(entry.name)) out.push(full);
  }
  return out.sort();
}

// The whole project's problems; none when cacheComponents is off.
export function treeProblems(root: string): Problem[] {
  if (!cacheComponentsOn(root)) return [];
  return [path.join(root, "app"), path.join(root, "src", "app")].flatMap(routeFiles).flatMap((f) => prerenderProblems(root, f));
}

// What the test prints, or "" when clean.
export function prerenderReport(problems: Problem[]): string {
  if (!problems.length) return "";
  return ["`next build` will refuse these under cacheComponents (a failed deploy):", ...problems.map((p) => `- ${p.message}`)].join("\n");
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
