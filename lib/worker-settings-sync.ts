// Your account's settings on a Weft Worker (docs/architecture/project-hosts.md#settings-on-a-worker-wp3): the daemon
// reads its owner's account_settings row with its key (worker_account_settings, which returns only the allowlisted
// keys) and mirrors it into its own settings.json (lib/host-settings.ts applyAccountSettings, which checks each field
// again and drops anything else), so automations, /weft:done's model and the rest behave on a worker card as you set
// them on your Mac. It never waits in front of a turn: it reads at start, every minute, and when a command arrives
// (nudge, at most every 15 s, not awaited), so a turn starts on what was mirrored last.
export interface SyncedRow {
  settings: unknown;
  updated_at: string;
}

export interface SettingsSyncDeps {
  read(): Promise<SyncedRow | null>;
  apply(settings: unknown): string[];
  log(msg: string): void;
  everyMs?: number;
  gapMs?: number;
  now?: () => number;
}

const EVERY_MS = 60_000;
const GAP_MS = 15_000;

export function createSettingsSync(deps: SettingsSyncDeps) {
  const now = deps.now ?? Date.now;
  let seen: string | null = null;
  let last = -Infinity;
  let running: Promise<void> | null = null;
  let warned = false;

  async function pass(): Promise<void> {
    try {
      const row = await deps.read();
      if (!row || row.updated_at === seen) return;
      const changed = deps.apply(row.settings);
      seen = row.updated_at;
      if (changed.length) deps.log(`Weft Worker: your settings changed: ${changed.join(", ")}`);
    } catch (err) {
      if (!warned) deps.log(`Weft Worker: reading your settings: ${(err as Error).message}`);
      warned = true;
    }
  }

  // One read at a time; a second asks while one runs share it.
  function sync(): Promise<void> {
    last = now();
    running ??= pass().finally(() => {
      running = null;
    });
    return running;
  }

  function nudge(): void {
    if (now() - last >= (deps.gapMs ?? GAP_MS)) void sync();
  }

  function start(): () => void {
    void sync();
    const timer = setInterval(() => void sync(), deps.everyMs ?? EVERY_MS);
    return () => clearInterval(timer);
  }

  return { sync, nudge, start };
}
