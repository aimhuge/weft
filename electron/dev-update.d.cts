// Type shim for ./dev-update.cjs so its test gets real types instead of `any`.

export type Run = (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<string>;

export interface Survey {
  from: string;
  target: string;
  behind: number;
  ahead: number;
  notes: string;
}

export interface DevGit {
  survey(): Promise<Survey>;
  pull(from: string, target: string): Promise<string[]>;
  head(): Promise<string>;
  changed(from: string, to: string): Promise<string[]>;
  diskVersion(): string | null;
}

export interface DevState {
  phase: "idle" | "checking" | "available" | "pulling" | "ready";
  commits?: number;
  target?: string;
  full?: string;
  from?: string;
  notes?: string;
  version?: string | null;
  pulled?: number;
  upToDate?: boolean;
  error?: string;
  checkedAt?: number;
}

export interface BaseUpdater {
  start(): void;
  stop(): void;
  info(): Record<string, unknown>;
}

export interface DevUpdater {
  check(): Promise<DevState>;
  pull(): Promise<DevState>;
  download(): Promise<DevState>;
  install(): Promise<boolean>;
  installNow(): boolean;
  menuItem(): { label: string; click: () => void };
  start(): void;
  stop(): void;
  state(): DevState;
  info(): Record<string, unknown> & { state: DevState; dev: true };
}

export type CardsEditing = (files: string[]) => Promise<Record<string, string[]>>;
export function devGit(options: {
  dir: string;
  run?: Run;
  readFile?: (file: string) => string;
  backupRoot?: string | null;
  cardsEditing?: CardsEditing;
}): DevGit;
export function withDevUpdates(
  base: BaseUpdater,
  options: {
    git: DevGit;
    currentVersion: string;
    relaunch: () => Promise<void>;
    onChange?: (state: DevState) => void;
    openWindow?: (() => void) | null;
    log?: { warn?: (msg: string) => void };
  },
): DevUpdater;
export function needsRestart(files: string[]): boolean;
export const runCommand: Run;
export const BRANCH: string;
