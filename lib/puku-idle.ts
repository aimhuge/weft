import { pukuDotenvShield } from "./puku-dotenv";
import type { Backend } from "./types";

// Why an idle puku-cli burned 10-30% CPU: in headless mode it runs `setInterval(gc, 1000)`, a line
// from Claude Code, where `gc` is Bun's cheap hint. puku-cli runs on Node, and its bin relaunches itself
// with `--expose-gc`, so the same line forces a full, synchronous V8 collection every second, costing
// more the bigger the session's heap. Skipping the relaunch leaves `gc` unexposed, so no timer
// (measured: 8-15% → 0.1% idle), and puku runs as one process instead of a wrapper plus its `Puku` child.
// The price: Node's default heap limit (~4 GB on a 16 GB Mac) instead of puku's 8 GB.
export const PUKU_IDLE_ENV = { PUKU_CLI_DISABLE_HEAP_RELAUNCH: "1" } as const;

// A puku thread also starts with the project's .env kept out of its sign-in (lib/puku-dotenv.ts).
export function backendEnv(backend: Backend, env: Partial<Record<string, string>> = process.env): Record<string, string> {
  return backend === "puku" ? { ...PUKU_IDLE_ENV, ...pukuDotenvShield(env) } : {};
}

// Idle puku CLIs kept open at most, under the overall cap, and their keep-alive. Each one is a whole
// Node process, so they're held tighter than Claude Code's native binary even with the gc timer gone.
export const MAX_IDLE_PUKU = 2;
export const PUKU_KEEP_ALIVE_MINUTES = 10;

// A session's keep-alive in minutes (0: never closes on a timer). Imported sessions and puku ones
// close after 10 idle minutes at most, whatever the setting says.
export function keepAliveFor(backend: Backend, imported: boolean, settingMinutes: number) {
  const capped = imported || backend === "puku";
  return capped ? Math.min(settingMinutes || PUKU_KEEP_ALIVE_MINUTES, PUKU_KEEP_ALIVE_MINUTES) : settingMinutes;
}

// Which idle sessions to close, given them oldest first: the oldest past `maxAll` overall, then the
// oldest puku ones past MAX_IDLE_PUKU among those left.
export function idleToClose<T extends { spec: { backend: Backend } }>(idleOldestFirst: T[], maxAll: number): T[] {
  const close = new Set(idleOldestFirst.slice(0, Math.max(0, idleOldestFirst.length - maxAll)));
  const puku = idleOldestFirst.filter((s) => !close.has(s) && s.spec.backend === "puku");
  for (const s of puku.slice(0, Math.max(0, puku.length - MAX_IDLE_PUKU))) close.add(s);
  return idleOldestFirst.filter((s) => close.has(s));
}

// A spare is only worth keeping warm for Claude Code and puku, which keep a CLI process open between turns.
// Codex starts a fresh `exec` process for each turn, so it has no spare process to refill.
export function refillsSpare(backend: Backend) {
  return backend === "claude";
}
