import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Safety net: tests never see the real ~/.weft or ~/.claude. Files that need clean state set their own
// WEFT_DATA (and HOME) to a fresh temp dir before importing the module under test.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "weft-test-"));

// Vitest can't load the real `server-only` (it's a Next build-time marker), so alias every import of it to an
// empty stub. `@aimhuge/billing/server` opens with `import "server-only"`, so the alias has to resolve inside
// that package too — `server.deps.inline` inlines it into our test process.
const serverOnlyStub = path.resolve(__dirname, "test/server-only-stub.ts");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": serverOnlyStub,
    },
  },
  test: {
    // Component tests opt into jsdom per file (`// @vitest-environment jsdom`); everything else stays on node.
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.tsx", "app/**/*.test.tsx", "electron/**/*.test.ts", "scripts/**/*.test.ts", "scripts/**/*.test.mjs", "plugin/**/*.test.ts"],
    environment: "node",
    // Vitest 4's default threads pool times out spawning workers in CI under load (a few
    // files "fail to start forks worker" with no error in the worker). Forks is stable.
    pool: "forks",
    // Cap concurrent workers. The default equals cpus() — 10 on this box — and each worker inlines @aimhuge/*
// plus Next's module graph, so a worker is easily 300-600 MB. Weft's own processes (next-server 0.8-1.9 GB,
// Electron main ~220 MB, renderer ~440 MB, the pane and the thread CLIs) already hold most of a 16 GB box,
// so a sweep at the core count pushed the Mac into swap and took the app down with it (twice, 2026-10-21).
// Two keeps a full run useful without squeezing a live Weft session. Raise deliberately, never by default:
//   MAX_WORKERS=4 pnpm test
maxWorkers: Number(process.env.MAX_WORKERS) || 2,
    // Bound each worker's V8 heap, so one runaway fork fails its own test loudly instead of taking the
    // whole box's memory. `execArgv` is top-level because Vitest 4 removed `poolOptions`, where a nested
    // execArgv is silently ignored. This is a *JS heap* cap only: it can't see RSC, turbopack's native
    // buffers or mmap'd module graphs — the allocations that actually crashed us. The real cap on a whole
    // suite's total resident memory is the RSS watchdog in scripts/test-watchdog.mjs, wired through
    // scripts/run-tests.mjs (a `pnpm test lib/x.test.ts` is never watched: short, scoped, and fine).
    // WORKER_HEAP (MB) overrides it.
    execArgv: [`--max-old-space-size=${Number(process.env.WORKER_HEAP) || 768}`],
    // A worker whose run died (its parent killed mid-test) ends itself instead of running on under PID 1.
    setupFiles: ["test/orphan-guard-setup.ts"],
    env: {
      WEFT_DATA: path.join(sandbox, "data"),
      CLAUDE_CONFIG_DIR: path.join(sandbox, "claude"),
      HOME: path.join(sandbox, "home"),
    },
    // Inline @aimhuge/* so the app's `server-only` alias applies inside those packages too
    // (node_modules/server-only is missing the empty export the alias replaces it with).
    server: { deps: { inline: [/@aimhuge\//] } },
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      // Test files, and the shared fakes they import (lib/runner.harness.ts).
      exclude: ["**/*.test.ts", "**/*.harness.ts"],
      reporter: ["text-summary", "text", "json-summary"],
    },
  },
});
