// Guards a whole-suite vitest sweep against the Mac it shares with a running Weft.
//
// The failure (2026-10-21, twice): a full run started while Weft was up. Vitest's worker count
// defaults to cpus() — 10 here — and each fork inlines @aimhuge/* and Next's module graph, so a worker
// is 300-600 MB. Weft's own processes (next-server 0.8-1.9 GB, Electron main ~220 MB, the renderer
// ~440 MB, the pane and every thread CLI) already hold most of a 16 GB box. Adding workers drove the
// Mac into swap and the OOM / v8 abort took Weft down with it.
//
// Two limits, because worker count alone doesn't bound memory:
//   • vitest.config.ts execArgv caps each worker's old-space, so one runaway fork can't take GB by itself.
//   • This module refuses a whole-suite run when free memory is already critically low — the difference
//     between "Weft crashed" and "close something and try again".
//
// A run of named files is never gated: those are quick and scoped, and that's how a thread verifies
// one change. Plain .mjs so scripts/run-tests.mjs can import it without a TS loader.

import { execFileSync } from "node:child_process";
import os from "node:os";

// A full sweep of 700 files needs roughly this much genuinely available. Below it, starting the run is
// what tips the box over. Raised/lowered by the caller for tests.
export const MIN_FREE_MB = 2048;

// macOS keeps most of its "free" memory in the inactive/purgeable file cache, so raw `free` alone
// understates what's available; but swap already in use is memory the box has promised and not got.
// All inputs in bytes; result in MB.
export function freeMemoryMb({ free, inactive, purgeable }, swapUsedBytes) {
  return Math.floor((free + inactive + purgeable - swapUsedBytes) / 1e6);
}

// Reads vm_stat + sysctl. Returns ok:false when a sweep would be unsafe to start.
export function checkMemoryPressure(minFreeMb = MIN_FREE_MB) {
  const totalMb = Math.floor(os.totalmem() / 1e6);
  let pressure;
  try {
    const out = execFileSync("/usr/bin/vm_stat", { encoding: "utf8" });
    const pageSize = Number(out.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
    const grab = (key) => {
      const m = out.match(new RegExp(`${key}:\\s+(\\d+)\\.`));
      return m ? Number(m[1]) * pageSize : 0;
    };
    const swapOut = execFileSync("/usr/sbin/sysctl", ["-n", "vm.swapusage"], { encoding: "utf8" });
    const swapUsed = (Number(swapOut.match(/used\s*=\s*([\d.]+)\s*M/)?.[1] ?? 0)) * 1e6;
    const freeMb = freeMemoryMb(
      { free: grab("Pages free"), inactive: grab("Pages inactive"), purgeable: grab("Pages purgeable") },
      swapUsed,
    );
    pressure = { freeMb, swapUsedMb: Math.round(swapUsed / 1e6), totalMb, ok: freeMb >= minFreeMb };
  } catch {
    // Not macOS (Linux CI), or vm_stat/sysctl unavailable: os.freemem() is the best figure, and the
    // threshold still applies, so the gate behaves the same on every platform.
    const freeMb = Math.floor(os.freemem() / 1e6);
    pressure = { freeMb, swapUsedMb: 0, totalMb, ok: freeMb >= minFreeMb };
  }
  return pressure;
}

// What the thread sees when the gate refuses, and what to do instead.
export function pressureMessage(p, minFreeMb) {
  return (
    `[vitest] not starting a full sweep: ~${p.freeMb} MB available of ${p.totalMb} MB ` +
    `(${p.swapUsedMb} MB already swapped), and a sweep needs ~${minFreeMb} MB free.\n` +
    `[vitest] Restart Weft's dev server (it holds ~1 GB), or close a few apps, then retry.\n` +
    // The gate itself ignores MAX_WORKERS, so the flag that skips it has to be named too.
    `[vitest] To run anyway: MAX_WORKERS=1 pnpm test --no-memory-gate   (one worker is ~500 MB)`
  );
}