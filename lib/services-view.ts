import { HEAVY_KB } from "./dev-idle";
import { folderName } from "./format";
import { taskDuration } from "./tasks-view";
import type { ServiceEntry, ServiceState } from "./types";

// How the rail's Services drawer (components/ServicesDrawer.tsx) reads GET /api/services.

// The board's project's services (a folder inside it counts), plus the ones with no folder: Weft
// itself, terminals and other commands belong to the whole app. Everything when no project is picked.
export function filterServices(services: readonly ServiceEntry[], project: string | null): ServiceEntry[] {
  if (!project) return [...services];
  return services.filter((s) => !s.cwd || s.cwd === project || s.cwd.startsWith(`${project}/`));
}

const LIVE = new Set<ServiceState>(["running", "starting"]);

// What Weft started that is still up: the rail's count. Weft itself doesn't count.
export function liveCount(services: readonly ServiceEntry[]): number {
  return services.filter((s) => s.kind !== "weft" && LIVE.has(s.state)).length;
}

export function servicesTitle(live: number): string {
  return live ? `Services: ${live} running` : "Services: nothing running";
}

// 4.1% under ten, 12% above; 100% is one core.
export function formatCpu(cpu: number): string {
  return cpu < 10 ? `${cpu.toFixed(1)}%` : `${Math.round(cpu)}%`;
}

export function formatMem(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${Math.round(kb / 1024)} MB`;
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

export interface ServiceRow {
  key: string;
  label: string;
  // What the row leads with: the card's title when it has one ("Fix the login page"), else the label.
  name: string;
  // The second line: the label when the name is the title, the folder and the uptime ("Claude Code · deckcp · 17m").
  meta: string;
  url?: string;
  state: ServiceState;
  live: boolean;
  // Measured: a thread's own dev server is counted under its CLI, a stopped run has nothing to measure.
  cpu?: string;
  mem?: string;
  // A dev server over 3 GB of real memory (lib/dev-idle.ts HEAVY_KB): its number shows in red.
  heavy?: true;
  // What the memory number is.
  memTitle?: string;
  canKill: boolean;
  // An idle untracked server Weft is about to stop: Keep stops that.
  canKeep?: true;
  // Weft's own dev servers start again with their command; a thread's own can only be stopped.
  canRestart: boolean;
  note?: string;
}

// Shown as idle once it has had no visitor for this long; Weft stops it at 30 minutes.
const SHOW_IDLE_MS = 5 * 60_000;

// The idle check's word on a dev server (lib/dev-idle-loop.ts), for the row's second line.
export function idleNote(s: ServiceEntry, now: number): string | undefined {
  if (s.stopAt) return `idle · stops in ${Math.max(0, Math.ceil((s.stopAt - now) / 1000))}s`;
  if (s.idleStopped) return "stopped after 30 idle min";
  if (s.activeAt !== undefined && now - s.activeAt >= SHOW_IDLE_MS) return `idle ${taskDuration(now - s.activeAt)}`;
  return undefined;
}

function memory(s: ServiceEntry): Pick<ServiceRow, "mem" | "heavy" | "memTitle"> {
  const kb = s.footprintKb ?? s.memKb;
  const title = s.footprintKb ? "Real memory: RAM + compressed + swapped" : "Resident memory (RSS)";
  return { mem: formatMem(kb), memTitle: kb > HEAVY_KB ? `${title}, over 3 GB` : title, ...(kb > HEAVY_KB && { heavy: true as const }) };
}

export function serviceRow(s: ServiceEntry, now: number): ServiceRow {
  const live = LIVE.has(s.state);
  const meta = [s.untracked && "untracked", s.title && s.label, s.cwd && folderName(s.cwd), live ? taskDuration(now - s.startedAt) : undefined, idleNote(s, now)].filter(Boolean).join(" · ");
  return {
    key: s.id,
    label: s.label,
    name: s.title ?? s.label,
    meta,
    ...(s.url && { url: s.url }),
    state: s.state,
    live,
    ...(s.procs.length && { cpu: formatCpu(s.cpu), ...memory(s) }),
    canKill: s.kind !== "weft" && live,
    ...(s.stopAt && { canKeep: true as const }),
    canRestart: s.kind === "dev",
    ...(s.kind === "task" && { note: "Started inside its thread: its CPU and memory count under that thread's CLI." }),
    ...(s.kind === "weft" && { note: "Weft itself: quit Weft to end it." }),
  };
}

export const STATE_TONE: Record<ServiceState, string> = {
  running: "bg-ok",
  starting: "bg-accent",
  stopped: "bg-faint",
  failed: "bg-danger",
};
