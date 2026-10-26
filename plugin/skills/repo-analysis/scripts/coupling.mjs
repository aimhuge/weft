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

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

const files = new Map(); // path -> { imports: Set<absPath>, exports: boolean }

for (const rel of tracked) {
  const abs = path.join(root, rel);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }

  const targets = new Set();
  const specs = new Set();
  for (const re of [IMPORT_RE, REQUIRE_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) specs.add(m[1]);
  }

  for (const spec of specs) {
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
  }

  files.set(rel, {
    imports: targets,
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
// A cycle is a set of modules that import each other. It matters because it
// makes the code impossible to extract or test in isolation, and it is the
// thing a reviewer cannot see by reading one file.
const cycles = findCycles(files);
if (cycles.length === 0) {
  console.log("(none found)");
} else {
  for (const c of cycles.slice(0, 15)) {
    console.log("  " + c.map((x) => path.basename(x)).join(" -> "));
  }
  console.log(`cycles: ${cycles.length}`);
}

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
  const samples = [];
  for (const [rel, info] of files) {
    if (!rel.startsWith(from + "/")) continue;
    for (const t of info.imports) {
      if (t.startsWith(to + "/")) {
        n++;
        if (samples.length < 3) samples.push(`${rel} -> ${t}`);
      }
    }
  }
  const mark = n === 0 ? "clean" : `${n} edge${n === 1 ? "" : "s"}`;
  console.log(`  ${label.padEnd(42)} ${mark}`);
  for (const s of samples) console.log(`      ${s}`);
}

// Tarjan's SCC, iterative so a deep graph doesn't blow the stack.
function findCycles(graph) {
  const t = { graph, index: new Map(), low: new Map(), onStack: new Set(), stack: [], out: [], counter: 0 };
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
  const kids = [...(t.graph.get(frame.node)?.imports ?? [])];
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
