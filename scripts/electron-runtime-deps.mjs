// Computes the packages Electron main needs at runtime, and their dependency closure.
//
// The packaged app's node_modules is an allow-list: electron-builder's "!node_modules${/*}" drops
// the whole top-level node_modules, and only what build.files names reaches app.asar. A package
// Electron main requires that isn't on the list is a launch crash ("Cannot find module") that no
// test in the repo can see, because the tests run against the repo's node_modules.
//
// So the list is derived, not hand-kept: this walks the bare requires out of electron/*.cjs, then
// the runtime requires out of each package it finds, transitively. The result is the closure.
//
//   node scripts/electron-runtime-deps.mjs          # print the packages
//   node scripts/electron-runtime-deps.mjs --write  # write build.files into package.json
//
// Native packages (node-pty) need their prebuilt binary and their own layout, so they carry
// extra patterns; NATIVE_EXTRA holds those.
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON_DIR = path.join(ROOT, "electron");

// Packages that need more than "the whole folder": a native binary, a prebuild, a subset of files.
const NATIVE_EXTRA = {
  "node-pty": ["node_modules/node-pty/package.json", "node_modules/node-pty/lib/**/*", "node_modules/node-pty/prebuilds/darwin-${arch}/**/*", "node_modules/node-pty/build/Release/**/*"],
};

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** A specifier's package name, or null when it isn't a bare package specifier. */
function packageOf(spec) {
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || builtins.has(spec) || spec === "electron") return null;
  return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
}

/** The bare package names a file requires: no relatives, no builtins, no "electron" itself. */
function bareRequires(source) {
  const found = new Set();
  // CommonJS: require("pkg"), and ESM: import ... from "pkg" / export ... from "pkg".
  const specs = [
    ...[...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ...[...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  for (const spec of specs) {
    const name = packageOf(spec);
    if (name) found.add(name);
  }
  return found;
}

/**
 * The entry files Node loads for a package: its `main`, its `module`, and the
 * `require`/`import`/`default` targets of its `exports`.
 *
 * Both the CommonJS and the ESM build are read, because Electron may load either: a package's
 * `main` can vendor its own copy of a dependency that its `module` build imports from the
 * package itself. Reading only `main` misses the ESM build's dependencies (@supabase/phoenix,
 * which realtime-js's dist/module imports but its dist/main vendors), and the packaged app then
 * cannot resolve one of them.
 *
 * Reading only these entry points also keeps prose in comments and optional platform branches
 * (react-native, expo) out of the result.
 */
function entryFiles(name) {
  const dir = path.join(ROOT, "node_modules", name);
  const manifest = path.join(dir, "package.json");
  if (!fs.existsSync(manifest)) return [];
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const targets = [];
  const add = (value) => {
    // "main" and "module" are usually plain relative paths ("dist/main/index.js"), while the
    // entries of an "exports" map start with "./". Both are relative paths into the package.
    if (typeof value !== "string" || !value || value.startsWith("/") || value.includes(":")) return;
    targets.push(value.startsWith("./") ? value : `./${value}`);
  };
  add(pkg.main);
  add(pkg.module);
  const walkExports = (node) => {
    if (typeof node === "string") return add(node);
    if (!node || typeof node !== "object") return;
    for (const value of Object.values(node)) walkExports(value);
  };
  walkExports(pkg.exports);
  const files = [];
  for (const target of new Set(targets)) {
    const full = path.join(dir, target.slice(2));
    // A target may name a directory with its own entry file.
    const entry = fs.existsSync(full) && fs.statSync(full).isDirectory() ? path.join(full, "index.js") : full;
    if (fs.existsSync(entry)) files.push(entry);
  }
  return files;
}

/**
 * The runtime requires of a package: read out of the files it actually loads, following relative
 * imports into the package, and out of any package it requires in turn.
 */
function runtimeRequires(name, seen = new Set()) {
  const found = new Set();
  const dir = path.join(ROOT, "node_modules", name);
  if (!fs.existsSync(dir) || seen.has(dir)) return found;
  seen.add(dir);
  const visited = new Set();
  const visit = (file) => {
    // A file can be reached by more than one path (the CJS and ESM builds both import it), so
    // each one is read once.
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const dep of bareRequires(source)) found.add(dep);
    // Follow this package's own relative imports (its dist/ files import each other).
    for (const spec of [...source.matchAll(/(?:require\(\s*|from\s*)["'](\.[^"']+)["']/g)].map((m) => m[1])) {
      const target = path.resolve(path.dirname(file), spec);
      for (const candidate of [target, `${target}.js`, `${target}.mjs`, `${target}.cjs`, path.join(target, "index.js")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          visit(candidate);
          break;
        }
      }
    }
  };
  for (const entry of entryFiles(name)) visit(entry);
  return found;
}

/** The packages Electron main requires, directly. */
function directRequires() {
  const found = new Set();
  for (const file of fs.readdirSync(ELECTRON_DIR)) {
    if (!file.endsWith(".cjs")) continue;
    for (const name of bareRequires(fs.readFileSync(path.join(ELECTRON_DIR, file), "utf8"))) found.add(name);
  }
  return found;
}

/**
 * The closure: the direct requires and everything they pull in at runtime.
 *
 * Only packages Weft actually has installed count. A specifier naming a package that isn't here
 * (an optional peer, a platform-specific extra) is not something the packaged app can ship.
 */
export function runtimeClosure() {
  const closure = new Set();
  const queue = [...directRequires()];
  while (queue.length) {
    const name = queue.pop();
    if (closure.has(name)) continue;
    if (!fs.existsSync(path.join(ROOT, "node_modules", name, "package.json"))) continue;
    closure.add(name);
    for (const dep of runtimeRequires(name)) if (!closure.has(dep)) queue.push(dep);
  }
  return closure;
}

/** The build.files patterns that ship a package. */
export function filePatterns(names) {
  const patterns = [];
  for (const name of [...names].sort()) {
    if (NATIVE_EXTRA[name]) {
      patterns.push(...NATIVE_EXTRA[name]);
      continue;
    }
    patterns.push(`node_modules/${name}/**/*`);
  }
  return patterns;
}

if (import.meta.filename === process.argv[1]) {
  const closure = runtimeClosure();
  const patterns = filePatterns(closure);
  if (process.argv.includes("--write")) {
    const pkgPath = path.join(ROOT, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    // Everything before the node_modules patterns is the fixed part of the list.
    const head = pkg.build.files.filter((f) => !f.startsWith("node_modules/"));
    pkg.build.files = [...head, ...patterns];
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`Wrote ${patterns.length} package patterns into package.json's build.files`);
  } else {
    for (const name of [...closure].sort()) console.log(name);
  }
}
