// Diffs two V8 .heapsnapshot files by constructor.
//
// V8's heap-snapshot format (verified against v8's heap-snapshot.ts in node 24):
//   root.snapshot.meta.node_fields: [type, name, id, self_size, edge_count, detachedness]
//   root.snapshot.meta.node_types: rows like ["hidden","array","string",…,"object shape"]; "object shape"
//   marks the boundary — hidden/string/array/code/closure/regexp/number/native/synthetic/etc. up to
//   "object shape" are the well-known kinds; everything after is a per-instance class.
//   root.nodes: a flat Float64Array of length node_count*6. For an object row the `name` field is an
//   index into root.strings (the class name; "<dummy>" for the hidden-dummy placeholder).
//   root.snapshot.meta.edge_types: [ [kind, type], [kind, type], [kind, type] ] for context/element/property.
//   We don't need edges for a constructor histogram.
//
// Group by (kind_name, class_name) and report biggest absolute deltas. The OOM hunt cares whether
// Error / NativeAccessorInfo / ScriptState climb between the two snapshots.
//
// Usage:
//   node scripts/snapshot-diff.mjs <a.heapsnapshot> <b.heapsnapshot> [top-N=60] [min-pct=5]

import fs from "node:fs";

const [, , aPath, bPath, topNArg = "60", minPctArg = "5"] = process.argv;
if (!aPath || !bPath) {
  console.error("usage: snapshot-diff.mjs <a.heapsnapshot> <b.heapsnapshot> [top-N=60] [min-pct=5]");
  process.exit(1);
}
const TOP_N = Number(topNArg);
const MIN_PCT = Number(minPctArg);

const NODE_FIELDS = 6;

function indexByConstructor(path) {
  const j = JSON.parse(fs.readFileSync(path, "utf8"));
  const kinds = j.snapshot.meta.node_types; // array of names
  const nodes = j.nodes;
  // A node whose type is one of the well-known kinds (hidden/array/string/…) carries that kind's
  // name as its "constructor"; class instances carry their class name in the `name` field (an index
  // into `strings`). The "object shape" sentinel separates the two groups.
  const OBJECT_SHAPE_INDEX = kinds.indexOf("object shape");
  const counts = new Map();
  for (let i = 0; i < j.snapshot.node_count; i++) {
    const off = i * NODE_FIELDS;
    const type = nodes[off];
    const nameIdx = nodes[off + 1];
    const label =
      type <= OBJECT_SHAPE_INDEX ? kinds[type] : j.strings[nameIdx] || "(unknown)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

function indexSelfSize(path) {
  const j = JSON.parse(fs.readFileSync(path, "utf8"));
  const kinds = j.snapshot.meta.node_types;
  const nodes = j.nodes;
  const OBJECT_SHAPE_INDEX = kinds.indexOf("object shape");
  const self = new Map();
  let total = 0;
  for (let i = 0; i < j.snapshot.node_count; i++) {
    const off = i * NODE_FIELDS;
    const type = nodes[off];
    const nameIdx = nodes[off + 1];
    const size = nodes[off + 3];
    total += size;
    const label =
      type <= OBJECT_SHAPE_INDEX ? kinds[type] : j.strings[nameIdx] || "(unknown)";
    self.set(label, (self.get(label) ?? 0) + size);
  }
  return { self, total };
}

const aCounts = indexByConstructor(aPath);
const bCounts = indexByConstructor(bPath);
const aSize = indexSelfSize(aPath);
const bSize = indexSelfSize(bPath);

const keys = new Set([...aCounts.keys(), ...bCounts.keys()]);
const rows = [];
for (const k of keys) {
  const a = aCounts.get(k) ?? 0;
  const b = bCounts.get(k) ?? 0;
  rows.push({
    key: k,
    a,
    b,
    delta: b - a,
    aBytes: aSize.self.get(k) ?? 0,
    bBytes: bSize.self.get(k) ?? 0,
  });
}
rows.sort((u, v) => Math.abs(v.delta) - Math.abs(u.delta));
// A snapshot has 100k+ distinct constructors; spreading that many args overflows the stack.
const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.delta)), 0) || 1;

console.log(`# object count by constructor (Δ ≥ ${MIN_PCT}% of max shown)`);
console.log(
  `total objects:  ${[...aCounts.values()].reduce((x, y) => x + y, 0).toLocaleString()} → ${[...bCounts.values()].reduce((x, y) => x + y, 0).toLocaleString()}`,
);
const aBytesTotal = [...aSize.self.values()].reduce((x, y) => x + y, 0);
const bBytesTotal = [...bSize.self.values()].reduce((x, y) => x + y, 0);
console.log(
  `total self-size: ${(aBytesTotal / 1e6).toFixed(0)} MB → ${(bBytesTotal / 1e6).toFixed(0)} MB  (Δ ${((bBytesTotal - aBytesTotal) / 1e6).toFixed(0)} MB)`,
);
console.log();
console.log("DELTA\t\tmax%\ta→b\tself-a(self-b)\tconstructor");
let count = 0;
for (const r of rows) {
  const pct = (Math.abs(r.delta) / maxAbs) * 100;
  if (pct < MIN_PCT) continue;
  const sign = r.delta >= 0 ? "+" : "";
  console.log(
    `${sign}${r.delta.toLocaleString()}\t\t${pct.toFixed(1).padStart(5)}%\t${r.a.toLocaleString()}→${r.b.toLocaleString()}\t${(r.aBytes / 1e6).toFixed(1)}MB (${(r.bBytes / 1e6).toFixed(1)}MB)\t${r.key}`,
  );
  if (++count >= TOP_N) break;
}
console.log();
console.log("# the OOM hunt: error / call / stack / error-related constructors");
for (const r of rows) {
  if (!/error|exception|call|stack|native|regexp|closure|context/i.test(r.key)) continue;
  const sign = r.delta >= 0 ? "+" : "";
  console.log(`  ${sign}${r.delta.toLocaleString().padStart(8)}  ${r.a.toLocaleString()}→${r.b.toLocaleString()}  ${(r.aBytes/1e6).toFixed(1)}→${(r.bBytes/1e6).toFixed(1)}MB  ${r.key}`);
}