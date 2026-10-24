import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "./client-graph";

// The guard on every board-side fetch.
//
// lib/guard.ts refuses every route — reads included — once the desktop app has written a launch token. A client
// fetch that forgets the x-weft-token header gets a 403, and the call site usually swallows it into an empty
// default: the limits chart lost its history, the uncommitted counter and the quality, streak and league chips
// disappeared, and an open thread came back empty instead of erroring. Six call sites were found this way; the
// fix is lib/api-client.ts's apiFetch, and this test is what stops the seventh.
//
// The rule it enforces: a "use client" file's fetch of a local /api route carries the token — either through
// apiFetch, or through its own headers object with x-weft-token in it. A fetch to an absolute URL (a provider's
// API, a dev server) isn't ours and isn't checked.

const ROOT = path.resolve(__dirname, "..");
// Every directory that can hold a client file: components/, lib/ and the routes under app/ (the admin pages are
// client components too, and app/(admin)/admin/users/UsersTable.tsx fetches /api/admin/users).
const CLIENT_DIRS = ["components", "lib", "app"];

// The files that call the board's own routes without the token, and why that's allowed. Each is a route the
// board doesn't serve, or a fetch whose silence is the point.
const EXEMPT: Record<string, string> = {
  "components/ThemeSync.tsx":
    "/api/account here is analytics identity, which is optional by design (the file says so): a failure must leave the user anonymous, not raise an error.",
  "components/share-view/SharedCard.tsx": "weft.zip's share routes, authenticated by the visitor's session cookie, not the desktop's launch token.",
  "components/share-view/use-app-bridge.ts": "weft.zip's share routes, authenticated by the visitor's session cookie, not the desktop's launch token.",
  "components/share-view/AppSecretForm.tsx": "weft.zip's share routes, authenticated by the visitor's session cookie, not the desktop's launch token.",
};

// A fetch whose first argument is a string or template that starts with /api: a local route we serve.
function localApiUrl(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  // The callee is the identifier `fetch`.
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "fetch") return null;
  const arg = node.arguments[0];
  if (!arg) return null;
  if (ts.isStringLiteral(arg)) return arg.text.startsWith("/api") ? arg.text : null;
  if (ts.isTemplateExpression(arg)) {
    const head = arg.head.text;
    return head.startsWith("/api") ? head : null;
  }
  return null;
}

// The name of a property, quoted or not: "headers" or headers.
function propName(prop: ts.PropertyAssignment): string {
  const n = prop.name;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return "";
}

// The header names an object literal carries.
function literalHeaderNames(init: ts.ObjectLiteralExpression): string[] {
  return init.properties
    .filter((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p))
    .map((p) => propName(p));
}

// The shared constant every board-side fetch is built on. It lives in lib/api-client.ts, so a file that
// imports it carries the token even though the literal header name never appears in that file.
const SHARED_HEADER_NAMES = new Set(["API_HEADERS"]);

// Whether a headers value is one we know carries the token. It is either an object literal naming
// x-weft-token, or an identifier bound to a constant that does — which we resolve by looking at what the
// constant contains, not what it is called, so a rename can't quietly unguard a fetch.
function headersCarryToken(init: ts.Expression, sf: ts.SourceFile, seen = new Set<string>()): boolean {
  if (ts.isObjectLiteralExpression(init)) {
    if (literalHeaderNames(init).includes("x-weft-token")) return true;
    // A computed key: { [API_TOKEN_HEADER]: "1" }.
    if (
      init.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) &&
          ts.isComputedPropertyName(p.name) &&
          ts.isIdentifier(p.name.expression) &&
          p.name.expression.text === "API_TOKEN_HEADER",
      )
    ) {
      return true;
    }
    // A spread of another headers object: { ...API_HEADERS, "content-type": … }.
    return init.properties.some(
      (p) => ts.isSpreadAssignment(p) && ts.isIdentifier(p.expression) && headersCarryToken(p.expression, sf, seen),
    );
  }
  if (ts.isIdentifier(init)) return identifierCarriesToken(init.text, sf, seen);
  return false;
}

// The constant an identifier is bound to in this file, and whether its headers carry the token.
function identifierCarriesToken(name: string, sf: ts.SourceFile, seen = new Set<string>()): boolean {
  // A constant that spreads another one reaches across files (WRITE_HEADERS is API_HEADERS plus a
  // content-type), so resolve the spread's own identifier against the module it comes from.
  if (seen.has(name)) return false;
  seen.add(name);
  // A name imported from lib/api-client.ts is the shared headers object itself.
  if (SHARED_HEADER_NAMES.has(name) && importsApiClient(sf, name)) return true;
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
      if (!decl.initializer) continue;
      return headersCarryToken(decl.initializer, sf, seen);
    }
  }
  return false;
}

// Whether this file imports the named export from lib/api-client.ts.
function importsApiClient(sf: ts.SourceFile, name: string): boolean {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!stmt.moduleSpecifier.text.endsWith("api-client")) continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name?.text === name) return true;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      if (bindings.elements.some((e) => e.name.text === name)) return true;
    }
  }
  return false;
}

// Whether the call carries the token: apiFetch (lib/api-client.ts) does it for everyone; a raw fetch has to
// name the header itself.
function carriesToken(call: ts.CallExpression, sf: ts.SourceFile): boolean {
  const init = call.arguments[1];
  if (!init) return false;
  if (!ts.isObjectLiteralExpression(init)) return false;
  for (const prop of init.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (propName(prop) !== "headers") continue;
    if (headersCarryToken(prop.initializer, sf)) return true;
    // A spread inside the headers object: { ...API_HEADERS, "content-type": … }.
    if (ts.isSpreadAssignment(prop.initializer) && ts.isIdentifier(prop.initializer.expression)) {
      if (identifierCarriesToken(prop.initializer.expression.text, sf)) return true;
    }
  }
  return false;
}

// Every local /api fetch in a "use client" file that doesn't carry the token.
function unguardedFetches(file: string): { url: string; line: number }[] {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isClient = sf.statements.some(
    (s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === "use client",
  );
  if (!isClient) return [];
  const out: { url: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    const url = localApiUrl(node);
    if (url !== null && !carriesToken(node as ts.CallExpression, sf)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      out.push({ url, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("the board's fetches", () => {
  it("every /api fetch in a client file carries the launch token", () => {
    const problems: string[] = [];
    for (const dir of CLIENT_DIRS) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        if (rel in EXEMPT) continue;
        for (const hit of unguardedFetches(file)) {
          problems.push(`${rel}:${hit.line} fetches ${hit.url} without x-weft-token`);
        }
      }
    }
    expect(
      problems,
      [
        "These board-side fetches call a local /api route without x-weft-token. lib/guard.ts refuses every route",
        "once the desktop app has written a launch token — reads included — so each one 403s into a swallowed",
        "catch() and a silently missing UI feature. Send it through apiFetch (lib/api-client.ts).",
        "",
        ...problems,
      ].join("\n"),
    ).toEqual([]);
  });

  it("keeps the exemptions it claims, so the list can't go stale", () => {
    for (const rel of Object.keys(EXEMPT)) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} is exempt but no longer exists`).toBe(true);
    }
  });

  it("finds the client files under app/ too, so the admin pages are covered", () => {
    const admin = path.join(ROOT, "app/(admin)/admin/users/UsersTable.tsx");
    expect(fs.existsSync(admin)).toBe(true);
    expect(unguardedFetches(admin)).toEqual([]);
  });
});
