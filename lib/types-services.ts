// The rail's Services drawer: every process Weft spawned, grouped into the thing that started it
// (lib/services.ts builds them from one `ps`, lib/services-snapshot.ts adds what the server knows).

// weft: Weft itself (Electron, its helpers, the Next server and its workers); never killed from here.
// cli: a thread's Claude Code, puku or Codex CLI, with everything it started.
// dev: a dev server Weft runs for a card (lib/devserver.ts).
// task: a dev server a thread started in its own CLI (its processes sit under that CLI).
// terminal: a shell in the terminal drawer. other: anything else Weft's server or shell spawned.
export type ServiceKind = "weft" | "cli" | "dev" | "task" | "terminal" | "other";

export type ServiceState = "running" | "starting" | "stopped" | "failed";

export interface ServiceProc {
  pid: number;
  ppid: number;
  // %CPU as ps reports it (100 = one core).
  cpu: number;
  // Resident memory, KB.
  memKb: number;
  command: string;
}

export interface ServiceEntry {
  // "weft", "cli:<cardId>", "dev:<cardId>", "task:<cardId>:<taskId>", "pid:<pid>".
  id: string;
  kind: ServiceKind;
  label: string;
  cardId?: string;
  // The card's title.
  title?: string;
  cwd?: string;
  url?: string;
  state: ServiceState;
  // Summed over procs.
  cpu: number;
  memKb: number;
  startedAt: number;
  procs: ServiceProc[];
  // Set on a thread's own dev server, so Stop goes to its task.
  taskId?: string;
  // A dev server's real memory (RAM + compressed + swapped: macOS's phys_footprint, as `top -stats mem` reads it), KB.
  footprintKb?: number;
  // When a dev server last had a request from outside Weft or a turn on its card (lib/dev-idle.ts).
  activeAt?: number;
  // Stopped by Weft after 30 idle minutes; Start brings it back.
  idleStopped?: true;
  // A dev server Weft didn't start, found listening in a board folder (lib/dev-untracked.ts).
  untracked?: true;
  // An idle untracked server Weft will stop at this time unless kept (the toast's Undo).
  stopAt?: number;
}

// This Mac, so the drawer can say "2.8 of 10 cores · 7.9 of 16 GB" rather than a bare "276% CPU".
export interface MachineInfo {
  cores: number;
  memKb: number;
}

// The drawer's Dev servers section: a start command found in a working folder (lib/dev-commands.ts),
// with the Weft run that's using it, if any (lib/dev-launchers.ts).
export interface DevCommand {
  // What runs, from the folder: "pnpm dev", "bin/rails server".
  command: string;
  // Where it came from: "dev" (a package.json script), "Procfile web", "manage.py".
  label: string;
  // Guessed from the script's port flag or its framework's default.
  url?: string;
}

export interface LauncherRun {
  // The Services row it is ("dev:<key>").
  id: string;
  state: ServiceState;
  // When this run started, after its last restart too.
  startedAt: number;
  // How many times it was restarted (0 for a fresh start).
  restarts: number;
  // The card that started it, when a thread did (mcp__devservers__start), so the row can open it.
  cardId?: string;
  title?: string;
}

export interface LauncherCommand extends DevCommand {
  run?: LauncherRun;
  // Something already answers on its url that Weft didn't start (another terminal, another app).
  answering?: boolean;
}

export interface DevLauncher {
  cwd: string;
  commands: LauncherCommand[];
  // Weft's own folder: its dev server is the one serving this board, so it is listed but never started here.
  self?: boolean;
  // On Weft's own folder: the address this board answers on.
  url?: string;
}
