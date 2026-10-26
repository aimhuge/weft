// `pnpm test` and `pnpm coverage`: vitest, with whole-suite runs taking turns across cards. A run of named
// files (`pnpm test lib/x.test.ts`) is quick and goes straight through. Either way a signal that stops this
// script reaches vitest too (scripts/one-at-a-time.mjs runHolding). Usage: node scripts/run-tests.mjs [vitest args...]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runHolding } from "./one-at-a-time.mjs";
import { checkMemoryPressure, pressureMessage } from "./test-memory.mjs";
import { startWatchdog, DEFAULT_MAX_RSS_MB } from "./test-watchdog.mjs";

// Flags whose value is the next argument, so that argument isn't a file filter.
const TAKES_VALUE = new Set(["-t", "--testNamePattern", "--reporter", "--project", "--pool", "--shard", "--maxWorkers", "--config", "-c", "--root", "-r", "--environment"]);

// True when the args name files or folders to run, i.e. not the whole suite.
export function isFiltered(args) {
  return args.some((arg, i) => !arg.startsWith("-") && arg !== "run" && !TAKES_VALUE.has(args[i - 1] ?? ""));
}

// Where a run of named files writes its coverage report. Vitest empties its reports folder before a coverage
// run, so a scoped `pnpm test lib/x.test.ts --coverage` used to replace the whole-repo coverage/coverage-summary.json
// (which the header's code quality score reads, lib/coverage.ts) with one file's numbers, or none at all.
// Each run gets its own folder under this root (makeScopedCoverageDir): two at once (two cards, or a card
// and its subagents) sharing one folder failed with "Something removed the coverage directory".
export const SCOPED_COVERAGE_ROOT = path.join(os.tmpdir(), "weft-coverage-scoped");

// True when a run asks for coverage and leaves the report folder to us.
export function wantsScopedCoverage(args) {
  const coverage = args.some((arg) => arg === "--coverage" || arg.startsWith("--coverage."));
  return coverage && !args.some((arg) => arg.startsWith("--coverage.reportsDirectory"));
}

// A fresh folder of this run's own under SCOPED_COVERAGE_ROOT, for one named-file coverage report.
export function makeScopedCoverageDir(root = SCOPED_COVERAGE_ROOT) {
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, `${process.pid}-`));
}

// A named-file run's args, its coverage report moved out of coverage/ into dir unless it names its own folder.
export function scopedCoverageArgs(args, dir) {
  if (!wantsScopedCoverage(args)) return args;
  return [...args, `--coverage.reportsDirectory=${dir}`];
}

// Vitest 4 exports only its package.json, so its bin is found beside that.
function vitestBin() {
  return path.join(path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
}

// This script's own flags, which Vitest would refuse as unknown options.
const OWN_FLAGS = ["--no-memory-gate", "--no-watchdog"];

// The args with this script's own flags taken out, for Vitest.
export function vitestArgs(args) {
  return args.filter((arg) => !OWN_FLAGS.includes(arg));
}

export async function main(args) {
  if (!isFiltered(args)) {
    // Refuse to start a full sweep on a memory-constrained box (scripts/test-memory.mjs): without this,
    // every vitest fork inlines @aimhuge/* and pushes the Mac into swap alongside a running Weft, taking
    // Weft down with it (twice on 2026-10-21). A run of named files is short and scoped; never gated.
    if (!args.includes("--no-memory-gate")) {
      const pressure = checkMemoryPressure(Number(process.env.WEFT_TEST_MIN_FREE_MB) || undefined);
      if (!pressure.ok) {
        console.error(pressureMessage(pressure, Number(process.env.WEFT_TEST_MIN_FREE_MB) || 2048));
        return 1;
      }
    }
    // Whole-suite runs are also watched by an RSS watchdog (scripts/test-watchdog.mjs): Vitest's own
    // `vmMemoryLimit` measures V8 `heapUsed` after each file and only gates worker reuse — it cannot stop a
    // single runaway file and cannot see the off-heap allocations (RSC, turbopack native buffers) that have
    // actually crashed us. Bypassed by `--no-watchdog` so a debug session can let one blow through.
    if (args.includes("--no-watchdog")) {
      const vitest = [vitestBin(), "run", ...vitestArgs(args)];
      return runHolding("test", process.execPath, { args: vitest });
    }
    const limitMb = Number(process.env.WEFT_TEST_MAX_RSS_MB) || DEFAULT_MAX_RSS_MB;
    const vitest = [vitestBin(), "run", ...vitestArgs(args)];
    return runHolding("test", process.execPath, {
      args: vitest,
      // The watchdog polls the whole process tree of the child runHolding spawned, so it sees the vitest
      // main process and every fork worker.
      watchdog: { limitMb, start: startWatchdog },
    });
  }
  // The report's numbers print to the terminal; its folder is this run's alone and goes once vitest exits.
  const dir = wantsScopedCoverage(args) ? makeScopedCoverageDir() : null;
  const vitest = [vitestBin(), "run", ...scopedCoverageArgs(args, dir)];
  const child = spawn(process.execPath, vitest, { stdio: "inherit" });
  const forward = (signal) => child.kill(signal);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, forward);
  const code = await new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
