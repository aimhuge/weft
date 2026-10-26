// What the ⏰ components' tests share (components/Cron*.test.tsx, components/CronsDrawer.test.tsx): a cron
// to hand them, the fake clock they read the schedule against, and the crons' fake actions.
import { vi } from "vitest";
import type { Cron } from "@/lib/cron-types";
import type { Card } from "@/lib/types";

// A fixed "now" the tests read the schedule against: Wednesday 12 March 2025, 09:00 local.
export const NOW = new Date(2025, 2, 12, 9, 0, 0, 0).getTime();

export function makeCron(over: Partial<Cron> = {}): Cron {
  return {
    id: "k1",
    name: "Nightly sweep",
    prompt: "sweep the repo",
    expr: "0 9 * * *",
    mode: "fork",
    cwd: "/Users/me/dev/weft",
    backend: "claude",
    permissionMode: "default",
    enabled: true,
    by: "you",
    count: 2,
    runs: [],
    nextAt: NOW + 3_600_000,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW,
    ...over,
  };
}

// The crons' actions, faked. The real ones (lib/use-crons.ts) answer with the server's cron and the
// card a run made, so the fakes keep those shapes: a test that reads the answer isn't handed a void.
export function fakeCronUpdate() {
  return vi.fn<(id: string, patch: Partial<Cron>) => Promise<undefined>>(() => Promise.resolve(undefined));
}

export function fakeCronRun() {
  return vi.fn<(id: string) => Promise<Card>>(() => Promise.resolve({ id: "c-run", title: "A run", prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "backlog", createdAt: 0, updatedAt: 0 }));
}
