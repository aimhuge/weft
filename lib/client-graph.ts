import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { resolveSpec } from "./import-check";

// Finds server-only code a "use client" file pulls into the browser bundle. Next refuses to build a client
// module graph that reaches a "use cache" function, cacheLife/cacheTag or "server-only", and a build error fails
// the route before React runs, so no CrashGuard or BuildErrorBar sees it. On 2026-10-17 lib/share-types.ts
// imported SITE from lib/home.ts, whose loadHome() dynamically imports components/home/Home, which reaches
// lib/home-release.ts ("use cache"), and Weft wouldn't start; lib/client-graph.test.ts walks the real tree so
// pnpm test catches the next one. The TypeScript parser, so comments and strings that mention a directive don't count.

const SOURCE = /\.[cm]?[jt]sx?$/;
const CACHE_NAMES = new Set(["cacheLife", "cacheTag", "unstable_cacheLife", "unstable_cacheTag"]);
// Node's built-ins, which a browser bundle can't hold. Turbopack panics on them ("the chunking context
// does not support external modules") and the whole board route 500s with no error the UI can show —
// on 2026-10-24 components/ModelSelect.tsx imported lib/model-limit.ts, which reads ~/.weft off disk.
// A client component that needs one of these asks the server for the data instead (as the model
// pickers now read /api/limits/plans).
const NODE_BUILTINS = /^(?:node:)?(?:assert|async_hooks|buffer|child_process|cluster|console|constants|crypto|dgram|dns|domain|events|fs|http|http2|https|inspector|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|worker_threads|zlib)(?:\/|$)/;

export interface ModuleFacts {
  // The file's own directives ("use client", "use server"), from its prologue.
  directives: string[];
  // Every module it imports for a value, static or dynamic: `import type` and all-`type` lists are erased.
  imports: string[];
  // Why a client bundle can't hold it; empty when it can.
  serverOnly: string[];
}

export interface Leak {
  // Repo-relative files from a "use client" file to the server-only module, shortest first found.
  chain: string[];
  serverOnly: string[];
}

export function moduleFacts(src: string, file: string): ModuleFacts {
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, kind);
  const directives: string[] = [];
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) break;
    directives.push(s.expression.text);
  }
  const imports: string[] = [];
  const serverOnly = new Set<string>();
  const visit = (node: ts.Node) => {
    const spec = valueSpec(node);
    if (spec !== null) imports.push(spec);
    for (const why of serverOnlyReasons(node)) serverOnly.add(why);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { directives, imports, serverOnly: [...serverOnly] };
}

// The module a node imports for a value: an import or re-export not erased as types, or `import("x")`.
function valueSpec(node: ts.Node): string | null {
  if (ts.isImportDeclaration(node)) return typeOnlyImport(node.importClause) ? null : literal(node.moduleSpecifier);
  if (ts.isExportDeclaration(node)) return typeOnlyExport(node) ? null : literal(node.moduleSpecifier);
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return literal(node.arguments[0]);
  return null;
}

// Why one node keeps its module out of a client bundle: a "use cache" directive, `import "server-only"`,
// cacheLife/cacheTag imported for a value, or a Node built-in.
function serverOnlyReasons(node: ts.Node): string[] {
  if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && /^use cache(:|$)/.test(node.expression.text)) {
    return [`has a "${node.expression.text}" directive`];
  }
  const spec = ts.isImportDeclaration(node) ? valueSpec(node) : null;
  if (spec === null) return [];
  if (spec === "server-only") return ['imports "server-only"'];
  if (NODE_BUILTINS.test(spec)) return [`imports "${spec}"`];
  if (spec !== "next/cache") return [];
  return valueNames((node as ts.ImportDeclaration).importClause)
    .filter((name) => CACHE_NAMES.has(name))
    .map((name) => `imports ${name} from "next/cache"`);
}

// A string literal's text; null for anything else (`import(x)`, or `from y` in a half-written file).
function literal(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

// `import type …`, or `import { type A, type B }`: the bundler drops the whole statement. A bare `import "x"` runs.
function typeOnlyImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true;
  const named = clause.namedBindings;
  return !clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
}

function typeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return !!clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly);
}

// The names an import binds for a value, by their exported name (`cacheLife as life` is cacheLife).
function valueNames(clause: ts.ImportClause | undefined): string[] {
  const named = clause?.namedBindings;
  if (!named || !ts.isNamedImports(named)) return [];
  return named.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text);
}

// Source files under a folder, sorted, without node_modules or dot-folders (.next, .git).
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE.test(entry.name)) out.push(full);
  }
  return out.sort();
}

// Every server-only module the "use client" files under `dirs` reach, each with the shortest chain to it from
// any of them (one breadth-first walk from all at once). A "use server" module ends its branch: the client gets
// references to its actions, not its code. Packages, missing files and non-source files (CSS, JSON) are skipped.
export function clientLeaks(root: string, dirs: string[]): Leak[] {
  const facts = new Map<string, ModuleFacts>();
  const factsOf = (file: string) => {
    let f = facts.get(file);
    if (!f) facts.set(file, (f = moduleFacts(fs.readFileSync(file, "utf8"), file)));
    return f;
  };
  const queue = dirs.flatMap((d) => sourceFiles(path.join(root, d))).filter((f) => factsOf(f).directives.includes("use client"));
  const from = new Map<string, string | null>(queue.map((f) => [f, null]));
  const leaks: Leak[] = [];
  for (const file of queue) {
    const { directives, imports, serverOnly } = factsOf(file);
    if (directives.includes("use server")) continue;
    if (serverOnly.length) {
      leaks.push({ chain: chainTo(from, file).map((f) => path.relative(root, f).split(path.sep).join("/")), serverOnly });
      continue;
    }
    for (const spec of imports) {
      const target = resolveSpec(root, file, spec);
      if (!target || !SOURCE.test(target) || from.has(target)) continue;
      from.set(target, file);
      queue.push(target); // everything a client file imports is client code too
    }
  }
  return leaks;
}

function chainTo(from: Map<string, string | null>, file: string): string[] {
  const chain: string[] = [];
  for (let at: string | null | undefined = file; at; at = from.get(at)) chain.unshift(at);
  return chain;
}

// What the test prints: each chain and why its last module is server-only, and how to break it. "" when clean.
export function leakReport(leaks: Leak[]): string {
  if (!leaks.length) return "";
  return [
    "Client code reaches server-only modules, so Next won't build the board:",
    ...leaks.map((l) => `- ${l.chain.join(" → ")} (${l.serverOnly.join(", ")})`),
    "Break the chain: move what the client needs into a module of its own (as lib/site.ts holds SITE for lib/home.ts).",
  ].join("\n");
}
