// docs-drift.mjs — check the docs against the code. Prints; changes nothing.
// Usage: node docs-drift.mjs [project-dir]
//
// A repo with good docs has a different failure mode from one with poor
// docs: not missing docs, but docs that quietly stopped being true. This checks
// the ways that happens:
//
//   1. a path the doc names no longer exists
//   2. a symbol the doc names no longer exists
//   3. a source directory no doc mentions
//   4. a number in a doc the code has outgrown
//   5. a doc older than the code it documents
//
// It also filters the noise. A doc that says `src/foo.ts` or
// `example.com/docs/readme.md` is showing a shape, not claiming a file, so
// those are not drift. Neither is a template a mini-app is built from.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const start = Date.now();
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 128e6 });

const tracked = git("ls-files").split("\n").filter(Boolean);
const trackedSet = new Set(tracked);
const sourceFiles = tracked.filter(
  (f) => /\.(ts|tsx|cjs|mjs|js|jsx)$/.test(f) && !/\.(test|spec)\./.test(f) && !f.endsWith(".d.ts")
);

// All tracked files, by basename, so a doc naming a bare filename can be
// checked against the tree instead of guessed at.
const byBase = new Set(tracked.map((f) => path.basename(f)));
const byBaseNoExt = new Set(tracked.map((f) => path.basename(f).replace(/\.[^.]+$/, "")));

// Paths a doc can mention that are never real files in this repo: shapes,
// examples, URLs and templates.
const NOT_A_FILE = [
  /^src\/foo/i,
  /^example\.com/i,
  /^\.\.\//,
  /^example/i,
  /^(index\.html|App\.tsx|app\.css|main\.tsx|index\.tsx)$/,
  /^(wrangler|update|apps|items|meta|review|scan|index|account|audit-seq|supabase-token)\.json$/,
  /^\.weft-build\.json$/,
  /^weft-app\.json$/,
  /^copilot-window\.json$/,
  /^main-window\.json$/,
  /^coverage\/coverage-summary\.json$/,
  /^vault\/run-rules\.json$/,
  /^\.weft-source\.json$/,
  /^plan\.html$/,
  /^notes\.md$/,
  /^api-cli\.puku\.sh$/,
  /^\.test\.ts$/,
];

function findDocs() {
  const dirs = ["docs/architecture", "docs"];
  for (const d of dirs) {
    const full = path.join(root, d);
    if (!existsSync(full)) continue;
    const out = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (entry.endsWith(".md")) out.push(path.relative(root, p));
      }
    };
    walk(full);
    if (out.length) return [...new Set(out)].sort();
  }
  return [];
}

const docs = findDocs();
console.log("=== Docs inventory ===");
if (!docs.length) {
  console.log("(no docs found)");
  process.exit(0);
}
const docText = new Map();
for (const d of docs) {
  const t = readFileSync(path.join(root, d), "utf8");
  docText.set(d, t);
  console.log(String(t.split("\n").length).padStart(6), d);
}
console.log(`total docs: ${docs.length}`);

// 1. Paths named in docs that no longer exist.
console.log("");
console.log("=== 1. Paths named in docs that no longer exist ===");
const PATH_RE = /`([A-Za-z0-9_./@\[\]-]+\.(?:ts|tsx|cjs|mjs|sql|md|json|css|html|sh|yaml|yml))`/g;
const brokenPaths = [];
// A design doc (a "Status: design" line near its top) names the files it plans to add, which don't exist yet
// by definition: those are counted apart, not as drift.
const isDesign = (text) => /^Status:\s*design\b/im.test(text.split("\n").slice(0, 8).join("\n"));
const planned = [];
for (const [doc, text] of docText) {
  const seen = new Set();
  const into = isDesign(text) ? planned : brokenPaths;
  for (const m of text.matchAll(PATH_RE)) {
    const p = m[1];
    if (seen.has(p)) continue;
    seen.add(p);
    if (NOT_A_FILE.some((re) => re.test(p))) continue;
    if (p.includes("*")) continue;
    // A relative path in a doc may be relative to the doc's folder, then to
    // the repo root.
    const docDir = path.dirname(doc);
    const options = [
      path.join(root, p),
      path.join(root, docDir, p),
      path.join(root, path.dirname(docDir), p),
    ];
    if (options.some((o) => existsSync(o))) continue;
    // A bare filename may live anywhere in the tree.
    const base = path.basename(p);
    if (byBase.has(base)) continue;
    if (byBaseNoExt.has(base.replace(/\.[^.]+$/, ""))) continue;
    into.push([doc, p]);
  }
}
for (const [doc, p] of brokenPaths) console.log(`  ${doc} -> ${p}`);
console.log(`broken path references: ${brokenPaths.length}`);
if (planned.length) console.log(`paths design docs plan to add (not drift): ${planned.length} in ${new Set(planned.map(([d]) => d)).size} doc(s)`);

// 2. Symbols named in docs that no longer exist.
console.log("");
console.log("=== 2. Symbols named in docs that no longer exist ===");
const SYM_RE = /`([a-zA-Z_][a-zA-Z0-9_]*)\(\)`/g;
const JS_BUILTINS = new Set([
  "if", "for", "while", "return", "new", "typeof", "await", "async", "function",
  "const", "let", "var", "try", "catch", "delete", "void", "in", "of", "do",
  "switch", "case", "break", "continue", "class", "extends", "super", "this",
  "throw", "yield", "instanceof", "default", "export", "import", "else",
]);
// Every identifier defined anywhere in the source tree.
const defined = new Set();
for (const f of sourceFiles) {
  let t;
  try {
    t = readFileSync(path.join(root, f), "utf8");
  } catch {
    continue;
  }
  for (const m of t.matchAll(/\b(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    defined.add(m[1]);
  }
}
const missingSyms = [];
for (const [doc, text] of docText) {
  const seen = new Set();
  for (const m of text.matchAll(SYM_RE)) {
    const s = m[1];
    if (seen.has(s) || JS_BUILTINS.has(s)) continue;
    seen.add(s);
    if (defined.has(s)) continue;
    missingSyms.push([doc, s]);
  }
}
for (const [doc, s] of missingSyms) console.log(`  ${doc} -> ${s}()`);
console.log(`missing symbols: ${missingSyms.length}`);

// 3. Source directories no doc mentions.
console.log("");
console.log("=== 3. Source directories no doc mentions ===");
const allText = [...docText.values()].join("\n");
const topDirs = [...new Set(sourceFiles.map((f) => f.split("/")[0]))].sort();
let undocumented = 0;
for (const d of topDirs) {
  if (new RegExp(`\\b${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(allText)) continue;
  console.log(`  ${d}/ — no doc mentions it`);
  undocumented++;
}
console.log(`undocumented top-level dirs: ${undocumented}`);

// 4. Numbers in docs the code has outgrown.
console.log("");
console.log("=== 4. Numeric claims in docs ===");
const srcCount = sourceFiles.length;
const testCount = tracked.filter((f) => /\.(test|spec)\.[a-z]+$/.test(f)).length;
const NUM_CLAIM = /\b(\d+)\s+(files|modules|components|routes|tests|endpoints|migrations)\b/g;
const staleClaims = [];
for (const [doc, text] of docText) {
  for (const m of text.matchAll(NUM_CLAIM)) {
    const n = Number(m[1]);
    const noun = m[2];
    let actual = null;
    if (noun === "tests") actual = testCount;
    else if (noun === "migrations") actual = tracked.filter((f) => f.startsWith("supabase/migrations/")).length;
    else actual = srcCount;
    if (actual !== null && n > 0 && n < actual * 0.8) {
      staleClaims.push([doc, m[0], actual]);
    }
  }
}
for (const [doc, claim, actual] of staleClaims.slice(0, 20)) {
  console.log(`  ${doc}: claims "${claim}" — tree now has ${actual}`);
}
console.log(`claims scanned: ${staleClaims.length} (showing the first 20)`);

// 5. Doc freshness: a doc older than the code it names.
console.log("");
console.log("=== 5. Doc freshness (doc older than the code it names) ===");
const logTime = (pathspec) => {
  try {
    const out = git("log", "-1", "--format=%at", "--", pathspec).trim();
    return out ? Number(out) : 0;
  } catch {
    return 0;
  }
};
const stale = [];
for (const [doc, text] of docText) {
  const docTime = logTime(doc);
  if (!docTime) continue;
  let newest = 0;
  const names = [...text.matchAll(PATH_RE)].map((m) => m[1]).slice(0, 8);
  for (const p of names) {
    if (NOT_A_FILE.some((re) => re.test(p))) continue;
    const t = logTime(p);
    if (t > newest) newest = t;
  }
  if (newest > docTime) {
    const days = Math.floor((newest - docTime) / 86400);
    if (days >= 2) stale.push([doc, days]);
  }
}
for (const [doc, days] of stale.slice(0, 20)) {
  console.log(`  ${doc.padEnd(45)} doc ${String(days).padStart(3)}d old, code ${String(days).padStart(3)}d newer`);
}
console.log(`stale docs: ${stale.length}`);

console.log("");
console.log(`=== docs-drift: ${Math.round((Date.now() - start) / 1000)}s ===`);
