// coupling.mjs — import graph facts for one repo. Prints; changes nothing.
// Usage: node coupling.mjs [project-dir]
//
// One pass over the source files, in JS, because the shell version of this
// was O(files^2) greps and took ten minutes on a 1,400-file repo. Here the
// import graph is built once and every question is answered from it.
//
// Resolves local imports by path, not by basename: two modules can share a
// basename in different folders, and matching on the bare name would credit
// the wrong importer.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const SRC_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_RE = /\.(test|spec)\.[a-z]+$/;

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64e6 })
  .split("\n")
  .filter(Boolean)
  .filter((f) => SRC_RE.test(f))
  .filter((f) => !TEST_RE.test(f) && !f.endsWith(".d.ts"));

// A module's identity: the path without its extension. Imports name paths
// without extensions too, so that lines them up.
const idOf = (f) => f.replace(/\.[^./]+$/, "");

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']/g;
const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

const files = new Map(); // path -> { imports: Set<path>, runtime: Set<path>, exports: boolean }

// An import that only names types (`import type`, or a { type A, type B } list) is erased before the
// code runs, and a dynamic import() loads later, on demand. Neither can leave a module half-loaded, so
// cycles and layering count them apart from the static value imports that run at load.
function erasedAtLoad(clause) {
  const c = clause.trim();
  if (/^type\s/.test(c)) return true;
  const list = c.match(/^\{([\s\S]*)\}$/);
  if (!list) return false;
  const names = list[1].split(",").map((n) => n.trim()).filter(Boolean);
  return names.length > 0 && names.every((n) => n.startsWith("type "));
}

for (const rel of tracked) {
  const abs = path.join(root, rel);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }

  const targets = new Set();
  const runtime = new Set();
  const specs = new Map(); // spec -> whether any import of it runs at load
  const note = (spec, atLoad) => specs.set(spec, specs.get(spec) || atLoad);
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text)) !== null) note(m[2], !erasedAtLoad(m[1] ?? ""));
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(text)) !== null) note(m[1], true);
  DYNAMIC_RE.lastIndex = 0;
  while ((m = DYNAMIC_RE.exec(text)) !== null) note(m[1], false);

  for (const [spec, atLoad] of specs) {
    // Bare package specifier: external, not part of the local graph.
    if (!spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("@/")) continue;

    let resolved = null;
    if (spec.startsWith("@/")) {
      const base = path.join(root, spec.slice(2));
      resolved = resolveLocal(base, root);
    } else if (spec.startsWith(".")) {
      resolved = resolveLocal(path.resolve(path.dirname(abs), spec), root);
    } else {
      resolved = resolveLocal(path.join(root, spec), root);
    }
    if (resolved) targets.add(resolved);
    if (resolved && atLoad) runtime.add(resolved);
  }

  files.set(rel, {
    imports: targets,
    runtime,
    exports: /^export\s+(const|function|class|default|async function|let|var|type|interface|enum)/m.test(text),
    loc: text.split("\n").length,
  });
}

// Try the plausible extensions and index files for a path with no extension.
function resolveLocal(base, repoRoot) {
  const cands = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
  ];
  for (const c of cands) {
    if (!existsSync(c)) continue;
    const rel = path.relative(repoRoot, c);
    if (files.has(rel)) return rel;
    // The file may be in the tracked list but not yet parsed; accept it.
    if (SRC_RE.test(rel) && !TEST_RE.test(rel)) return rel;
  }
  return null;
}

// The graph is built; now every question is a pass over it.
const fanIn = new Map();
const fanOut = [];
for (const [rel, info] of files) {
  fanOut.push([info.imports.size, rel]);
  for (const t of info.imports) {
    if (t === rel) continue;
    fanIn.set(t, (fanIn.get(t) || 0) + 1);
  }
}

console.log("=== Coupling: import fan-out (top 20) ===");
for (const [n, rel] of fanOut.sort((a, b) => b[0] - a[0]).slice(0, 20)) {
  if (n > 0) console.log(String(n).padStart(5), rel);
}

console.log("");
console.log("=== Coupling: import fan-in (top 20) ===");
const sortedIn = [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
if (sortedIn.length === 0) console.log("(none)");
for (const [rel, n] of sortedIn) console.log(String(n).padStart(5), rel);

console.log("");
console.log("=== Coupling: files nothing imports ===");
// A module with exports that nothing imports is either dead code or a public
// entry point. Next.js route files are entry points by definition, so they
// are excluded — otherwise every page.tsx shows up as an orphan.
console.log("(next.js app/ route files excluded — they are entry points)");
let orphans = 0;
const orphanList = [];
for (const [rel, info] of files) {
  if (rel.startsWith("app/") || rel.startsWith("pages/")) continue;
  if (!info.exports) continue;
  if ((fanIn.get(rel) || 0) === 0) {
    orphans++;
    orphanList.push(rel);
  }
}
for (const rel of orphanList.sort().slice(0, 25)) console.log("  " + rel);
console.log("candidates: " + orphans);

console.log("");
console.log("=== Coupling: import cycles ===");
// A cycle is a set of modules that import each other. A runtime cycle (static value imports only)
// is the one that matters: a module can load half-initialised, and none of it can be extracted or
// tested alone. Cycles that close only through type-only or dynamic imports are listed apart: they
// are a smell in the type graph, not a load-order hazard, and must not be ranked as one.
const cycles = findCycles(files, "runtime");
if (cycles.length === 0) {
  console.log("(none found)");
} else {
  for (const c of cycles.slice(0, 15)) {
    console.log(`  [${c.length}] ` + c.map((x) => path.basename(x)).join(" -> "));
  }
  console.log(`runtime cycles: ${cycles.length}`);
}
const typeCycles = findCycles(files, "imports");
const biggest = typeCycles.reduce((n, c) => Math.max(n, c.length), 0);
console.log(`with type-only and dynamic imports too: ${typeCycles.length} cycles, largest ${biggest} modules (erased or lazy at load)`);

console.log("");
console.log("=== Coupling: layering ===");
// Does lib/ import from components/? Does app/ reach into electron/? Those
// edges point the wrong way and make a module hard to move.
const EDGES = [
  ["lib", "components", "lib/ imports components/"],
  ["lib", "app", "lib/ imports app/"],
  ["lib", "electron", "lib/ imports electron/"],
  ["components", "lib", "components/ imports lib/ (fine)"],
  ["app", "components", "app/ imports components/ (fine)"],
  ["app", "lib", "app/ imports lib/ (fine)"],
  ["electron", "lib", "electron/ imports lib/ (fine)"],
];
for (const [from, to, label] of EDGES) {
  let n = 0;
  let typeOnly = 0;
  const samples = [];
  for (const [rel, info] of files) {
    if (!rel.startsWith(from + "/")) continue;
    for (const t of info.imports) {
      if (!t.startsWith(to + "/")) continue;
      if (!info.runtime.has(t)) {
        typeOnly++;
        continue;
      }
      n++;
      if (samples.length < 3) samples.push(`${rel} -> ${t}`);
    }
  }
  const erased = typeOnly ? ` (+${typeOnly} type-only or lazy)` : "";
  const mark = (n === 0 ? "clean" : `${n} edge${n === 1 ? "" : "s"}`) + erased;
  console.log(`  ${label.padEnd(42)} ${mark}`);
  for (const s of samples) console.log(`      ${s}`);
}

// Tarjan's SCC, iterative so a deep graph doesn't blow the stack.
// edges: "runtime" for the static value imports, "imports" for every import.
function findCycles(graph, edges) {
  const t = { graph, edges, index: new Map(), low: new Map(), onStack: new Set(), stack: [], out: [], counter: 0 };
  for (const node of graph.keys()) {
    if (!t.index.has(node)) strongConnect(t, node);
  }
  return t.out;
}

// One DFS from a root, with an explicit work stack of { node, kid } frames.
function strongConnect(t, root) {
  const work = [enter(t, root)];
  while (work.length) {
    const frame = work[work.length - 1];
    const next = nextUnvisited(t, frame);
    if (next) {
      work.push(enter(t, next));
      continue;
    }
    closeComponent(t, frame.node);
    work.pop();
    const parent = work[work.length - 1];
    if (parent) t.low.set(parent.node, Math.min(t.low.get(parent.node), t.low.get(frame.node)));
  }
}

function enter(t, v) {
  t.index.set(v, t.counter);
  t.low.set(v, t.counter);
  t.counter++;
  t.stack.push(v);
  t.onStack.add(v);
  return { node: v, kid: 0 };
}

// The frame's next import not yet visited; imports already on the stack lower its low-link on the way.
function nextUnvisited(t, frame) {
  const kids = [...(t.graph.get(frame.node)?.[t.edges] ?? [])];
  while (frame.kid < kids.length) {
    const w = kids[frame.kid++];
    if (!t.graph.has(w)) continue;
    if (!t.index.has(w)) return w;
    if (t.onStack.has(w)) t.low.set(frame.node, Math.min(t.low.get(frame.node), t.index.get(w)));
  }
  return null;
}

// v is a component's root when its low-link is its own index: pop the component off the stack.
function closeComponent(t, v) {
  if (t.low.get(v) !== t.index.get(v)) return;
  const comp = [];
  let w;
  do {
    w = t.stack.pop();
    t.onStack.delete(w);
    comp.push(w);
  } while (w !== v);
  // An SCC of one is not a cycle unless it imports itself.
  if (comp.length > 1) t.out.push(comp.reverse());
}
