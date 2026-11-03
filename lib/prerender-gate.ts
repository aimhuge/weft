import ts from "typescript";

// The third check lib/prerender-check.ts runs: a page whose default export returns a static branch on an env gate
// before its <Suspense> (`if (!isWebEnabled()) return <NotDeployed />;`), while its generateMetadata reads params
// without returning on that gate first. When the gate is true at build time the page prerenders whole, so metadata
// that reads params is runtime data in a static route, even when it's "use cache": "Next.js encountered uncached or
// runtime data in generateMetadata(). This route's metadata is blocked, but the rest of its content can be
// prerendered". Vercel's build passed (VERCEL makes isWebEnabled() true) while the Mac release build, without
// VERCEL or WEFT_WEB, refused five share pages and kept 0.7.1 from packing (fixed in 03d0bb60). A heuristic: the
// gate matches by its source text, and a helper only counts when it's a function in the same file.

export const RUNTIME_PROPS = new Set(["params", "searchParams"]);

// A metadata function that reads params ahead of the page's gate: which one, what it reads, and the gate.
export interface UngatedRead {
  fn: string;
  what: string;
  gate: string;
}

type Fn = ts.FunctionLikeDeclaration;

// What each metadata function reads ahead of the gate the page's static branch returns on; none without a gate.
export function ungatedMetadata(page: Fn | undefined, metas: [string, Fn][], fns: Map<string, Fn>): UngatedRead[] {
  const gate = page && staticGate(page);
  if (!gate) return [];
  return metas.flatMap(([fn, meta]) => {
    const what = readBeforeGate(meta, gate, fns);
    return what ? [{ fn, what, gate }] : [];
  });
}

// The problem lib/prerender-check.ts reports for one, with its fix.
export function ungatedMessage(rel: string, u: UngatedRead): string {
  return `${rel}: ${u.fn} reads ${u.what} before returning on \`${u.gate}\`, the gate the default export's static branch returns on: a build where it holds (\`next build\` without VERCEL or WEFT_WEB, the Mac release build) prerenders the page whole and refuses its metadata, "Next.js encountered uncached or runtime data in ${u.fn}()". Start ${u.fn} with \`if (${u.gate}) return <static metadata>;\` and read params after it, through a "use cache" helper (as app/s/[id]/page.tsx's linkPreview does).`;
}

// The condition of the first top-level `if (cond) return <jsx>` in a function's body, before any <Suspense>.
function staticGate(fn: Fn): string | null {
  if (!fn.body || !ts.isBlock(fn.body)) return null;
  for (const s of fn.body.statements) {
    if (hasSuspense(s)) return null;
    if (ts.isIfStatement(s) && returning(s.thenStatement, isJsx)) return gateText(s.expression);
  }
  return null;
}

// What a function reads before an `if (gate) return …` at its top level, or null when the gate comes first.
function readBeforeGate(fn: Fn, gate: string, fns: Map<string, Fn>): string | null {
  if (!fn.body) return null;
  if (!ts.isBlock(fn.body)) return readIn(fn.body, fns, new Set());
  for (const s of fn.body.statements) {
    if (ts.isIfStatement(s) && gateText(s.expression) === gate && returning(s.thenStatement, () => true)) return null;
    const what = readIn(s, fns, new Set());
    if (what) return what;
  }
  return null;
}

// `params` for an awaited runtime prop, `params through linkPreview()` for a same-file function that reads one or
// is handed one; outside functions nested in the node.
function readIn(node: ts.Node, fns: Map<string, Fn>, seen: Set<string>): string | null {
  let found: string | null = null;
  const visit = (n: ts.Node) => {
    if (found || ts.isFunctionLike(n)) return;
    if (ts.isAwaitExpression(n)) found = propOf(n.expression);
    else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) found = helperRead(n, fns, seen);
    if (!found) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function helperRead(call: ts.CallExpression, fns: Map<string, Fn>, seen: Set<string>): string | null {
  const name = (call.expression as ts.Identifier).text;
  const fn = fns.get(name);
  if (!fn || seen.has(name)) return null;
  seen.add(name);
  const what = call.arguments.map(propOf).find(Boolean) ?? (fn.body ? readIn(fn.body, fns, seen) : null);
  return what ? `${what.split(" ")[0]} through ${name}()` : null;
}

// `params`, `props.params`: the runtime prop an expression is, or null.
function propOf(node: ts.Expression): string | null {
  const e = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isIdentifier(e) && RUNTIME_PROPS.has(e.text)) return e.text;
  if (ts.isPropertyAccessExpression(e) && RUNTIME_PROPS.has(e.name.text)) return e.name.text;
  return null;
}

// Whether a statement is a `return` (or a block holding one at its top level) whose value passes `ok`.
function returning(s: ts.Statement, ok: (e: ts.Expression | undefined) => boolean): boolean {
  if (ts.isReturnStatement(s)) return ok(s.expression);
  return ts.isBlock(s) && s.statements.some((x) => ts.isReturnStatement(x) && ok(x.expression));
}

function isJsx(e: ts.Expression | undefined): boolean {
  const x = e && ts.isParenthesizedExpression(e) ? e.expression : e;
  return !!x && (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x));
}

function hasSuspense(node: ts.Node): boolean {
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : ts.isJsxSelfClosingElement(node) ? node.tagName : null;
  if (tag && /^(React\.)?Suspense$/.test(tag.getText())) return true;
  return !!ts.forEachChild(node, (c) => hasSuspense(c) || undefined);
}

const gateText = (e: ts.Expression) => e.getText().replace(/\s+/g, "");
