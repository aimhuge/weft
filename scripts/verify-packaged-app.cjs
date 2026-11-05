// Checks the built app: that every package Electron main needs is really inside app.asar, and that
// the packaged account client can load and build a Supabase client from them.
//
// The check is deliberately strict: a package counts as shipped only if the archive itself holds
// it. Resolving with createRequire() from inside the asar is NOT enough — Node walks the real
// filesystem and finds the repo's node_modules, which has everything, so a broken asar would
// still pass. (That is how the first version of this script gave a false "ok" on an asar that was
// missing every Supabase package, and how the 2026-10-28 launch crash reached a shipped build.)
//
//   node scripts/verify-packaged-app.cjs <path to app.asar>
const path = require("node:path");
const { builtinModules } = require("node:module");

const asarPath = path.resolve(process.argv[2]);
const asar = require("@electron/asar");
const entries = new Set(asar.listPackage(asarPath));

// The packages Electron main needs, from the same source of truth the build uses.
const closure = require("./electron-runtime-deps.mjs");
const required = [...closure.runtimeClosure()].sort();

const results = [];
for (const name of required) {
  // A package is shipped if the archive holds its manifest.
  const manifest = `/node_modules/${name}/package.json`;
  if (entries.has(manifest)) {
    results.push(`ok    ${name}`);
  } else {
    results.push(`MISS  ${name} (no ${manifest} in the archive)`);
  }
}

// The real thing: load the packaged account client and build a client from it, with the archive's
// own files — the exact require that crashed the app on 2026-10-28.
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
try {
  const cache = new Map();

  const loadArchiveFile = (entry) => {
    if (cache.has(entry)) return cache.get(entry).exports;
    const inner = { exports: {} };
    cache.set(entry, inner);
    const source = asar.extractFile(asarPath, entry.replace(/^\//, "")).toString("utf8");
    const dir = path.posix.dirname(entry);
    const fn = new Function("exports", "require", "module", "__filename", "__dirname", source);
    fn(inner.exports, (spec) => requireInArchive(spec, dir), inner, entry, dir);
    return inner.exports;
  };

  const requireInArchive = (spec, fromDir) => {
    // Node builtins come from the runtime, not the archive.
    if (builtins.has(spec)) return require(spec);
    if (spec.startsWith(".")) {
      // A relative import: resolve it against the requiring file's folder, the way Node does.
      const base = path.posix.resolve(fromDir, spec);
      const entry = [base, `${base}.cjs`, `${base}.js`, `${base}.mjs`, `${base}/index.cjs`, `${base}/index.js`].find((c) => entries.has(c));
      if (!entry) throw new Error(`${spec} isn't in the archive (from ${fromDir})`);
      return loadArchiveFile(entry);
    }
    // A bare specifier: it must be in the archive, and we load it from there.
    const dir = `/node_modules/${spec}`;
    const manifest = `${dir}/package.json`;
    if (!entries.has(manifest)) throw new Error(`Cannot find module '${spec}'`);
    const pkg = JSON.parse(asar.extractFile(asarPath, manifest.replace(/^\//, "")).toString("utf8"));
    const main = pkg.main || "index.js";
    const entry = `${dir}/${main.replace(/^\.\//, "")}`;
    if (!entries.has(entry)) throw new Error(`Cannot find module '${spec}' (no ${entry})`);
    return loadArchiveFile(entry);
  };

  const source = asar.extractFile(asarPath, "electron/account-client.cjs").toString("utf8");
  const loaded = { exports: {} };
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", source);
  fn(loaded.exports, (spec) => requireInArchive(spec, "/electron"), loaded, "/electron/account-client.cjs", "/electron");

  const { createAccountClient } = loaded.exports;
  const client = createAccountClient({
    dataDir: require("node:os").tmpdir(),
    safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" },
  });
  const supabase = client.supabase;
  const ok = typeof supabase?.auth?.getSession === "function" && typeof supabase?.from === "function";
  results.push(`${ok ? "ok   " : "BAD  "} the packaged account client builds a Supabase client`);
} catch (e) {
  results.push(`BAD   the packaged account client failed to load: ${e.message}`);
}

console.log(results.join("\n"));
const bad = results.filter((r) => r.startsWith("MISS") || r.startsWith("BAD"));
console.log(bad.length === 0 ? "\nThe packaged app's Supabase client loads from inside the archive." : `\n${bad.length} problem(s).`);
process.exit(bad.length === 0 ? 0 : 1);
