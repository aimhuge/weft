// CI lint, split into shards. `node scripts/lint-shard.mjs <i>/<n>` runs eslint (same config, same
// --max-warnings 0) on the tracked source files whose path hash falls in shard i of n; `--check <n>` fails
// if the shards are not an exact partition of the lintable set (a file in none, or in two).
// The lintable set is every tracked file with an extension eslint.config.mjs lints (js, jsx, mjs, cjs, ts,
// tsx, mts, cts); files the config ignores are passed with --no-warn-ignored so they stay silent.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const LINTABLE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

export function lintableFiles(tracked) {
  return tracked.filter((file) => LINTABLE.test(file));
}

export function shardOf(file, count) {
  return createHash("md5").update(file).digest().readUInt32BE(0) % count;
}

export function shardFiles(files, index, count) {
  return files.filter((file) => shardOf(file, count) === index - 1);
}

// Problems with a split: files in no shard or in more than one. Empty when it is an exact partition.
export function partitionProblems(files, count) {
  const seen = new Map();
  for (let i = 1; i <= count; i++) for (const f of shardFiles(files, i, count)) seen.set(f, (seen.get(f) ?? 0) + 1);
  const problems = files.filter((f) => seen.get(f) !== 1).map((f) => `${f}: in ${seen.get(f) ?? 0} shards`);
  if ([...seen.keys()].some((f) => !files.includes(f))) problems.push("a shard holds a file outside the set");
  return problems;
}

function tracked() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\0").filter(Boolean);
}

function main(argv) {
  const files = lintableFiles(tracked());
  if (argv[0] === "--check") {
    const count = Number(argv[1]);
    const problems = partitionProblems(files, count);
    for (const p of problems) console.error(p);
    console.log(`${files.length} lintable files, ${count} shards, ${problems.length} problems`);
    return problems.length ? 1 : 0;
  }
  const [index, count] = (argv[0] ?? "").split("/").map(Number);
  if (!index || !count || index > count) {
    console.error("usage: lint-shard.mjs <i>/<n> [eslint args...] | --check <n>");
    return 2;
  }
  const mine = shardFiles(files, index, count);
  console.log(`lint shard ${index}/${count}: ${mine.length} of ${files.length} files`);
  const args = ["eslint", "--max-warnings", "0", "--no-warn-ignored", ...argv.slice(1), "--", ...mine];
  return spawnSync("pnpm", ["exec", ...args], { stdio: "inherit" }).status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
