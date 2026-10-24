// The pre-commit hook's first check (scripts/check-staged.sh): every relative or tsconfig-alias import in a staged file
// must resolve to a file in the index, not just on disk. tsc on the index copy catches this too, but only as a
// TS2307 among others; this names the file to `git add`, takes a second, and doesn't depend on tsc's incremental cache
// or on the type-check running at all. Twice on 2026-10-24 a commit imported a file that was still untracked and the
// Vercel build failed with "Module not found" (5b3b845, 0d6ed7e). Only files that exist untracked and not ignored on
// disk count as missing: an ignored or generated file is the build's business, a typo is tsc's.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const EXTS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
// `import x from "s"`, `export … from "s"`, `import "s"`, `import("s")`, `require("s")`.
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"'\n]+)["']/gm;

// The specifiers a file imports, comments left out so a commented-out import doesn't count.
export function importSpecifiers(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  return [...code.matchAll(SPEC)].map((m) => m[1]);
}

// tsconfig `paths` as prefix → base folders (`@/*` → `./*` is "@/" → [""]), relative to the repo root.
export function aliasMap(tsconfig) {
  const paths = tsconfig?.compilerOptions?.paths ?? {};
  const baseUrl = tsconfig?.compilerOptions?.baseUrl ?? ".";
  return Object.entries(paths)
    .filter(([key]) => key.endsWith("*"))
    .map(([key, targets]) => [key.slice(0, -1), targets.filter((t) => t.endsWith("*")).map((t) => path.posix.join(baseUrl, t.slice(0, -1)))]);
}

// The repo-relative paths a specifier from `fromFile` could mean, or null for a package import.
export function candidates(spec, fromFile, aliases) {
  let bases;
  if (spec.startsWith("./") || spec.startsWith("../")) bases = [path.posix.join(path.posix.dirname(fromFile), spec)];
  else {
    const alias = aliases.find(([prefix]) => spec.startsWith(prefix));
    if (!alias) return null;
    bases = alias[1].map((dir) => path.posix.join(dir, spec.slice(alias[0].length)));
  }
  const out = [];
  for (const base of bases) {
    out.push(base);
    // Bundler resolution maps "./x.js" to x.ts.
    const bare = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
    for (const ext of EXTS) out.push(bare + ext, `${base}/index${ext}`);
  }
  return out;
}

// Each staged file's imports that resolve to an untracked file instead of an indexed one.
export function missingImports({ staged, indexed, untracked, read, aliases }) {
  const problems = [];
  for (const file of staged.filter((f) => CODE.test(f))) {
    for (const spec of importSpecifiers(read(file))) {
      const options = candidates(spec, file, aliases);
      if (!options || options.some((c) => indexed.has(c))) continue;
      const loose = options.find((c) => untracked.has(c));
      if (loose) problems.push({ file, spec, untracked: loose });
    }
  }
  return problems;
}

function main() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  // Paths relative to the repo root, wherever the hook runs from.
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 256 << 20 });
  const list = (out) => out.split("\0").filter(Boolean);
  const staged = list(git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"));
  const indexed = new Set(list(git("ls-files", "-z")));
  const untracked = new Set(list(git("ls-files", "--others", "--exclude-standard", "-z")));
  let tsconfig = null;
  try {
    tsconfig = JSON.parse(git("show", ":tsconfig.json"));
  } catch {
    // No tsconfig, or one with comments: relative imports only.
  }
  const problems = missingImports({ staged, indexed, untracked, read: (f) => git("show", `:${f}`), aliases: aliasMap(tsconfig) });
  if (!problems.length) return 0;
  console.error("pre-commit: staged files import files that aren't staged (untracked):");
  for (const p of problems) console.error(`  ${p.file} imports "${p.spec}" → ${p.untracked}`);
  const files = [...new Set(problems.map((p) => p.untracked))];
  console.error(`Stage them too (git add ${files.join(" ")}), or the build fails with "Module not found".`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main();
