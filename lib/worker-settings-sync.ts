// Your account's settings on a Weft Worker (docs/architecture/project-hosts.md#settings-on-a-worker-wp3): the daemon
// reads its owner's account_settings row with its key (worker_account_settings, which returns only the allowlisted
// keys) and, once the Mac it was paired with is found to have signed it at a newer version (lib/account-settings-sig.ts),
// mirrors it into its own settings.json (lib/host-settings.ts applyAccountSettings, which checks each field
// again and drops anything else), so automations, /weft:done's model and the rest behave on a worker card as you set
// them on your Mac. It never waits in front of a turn: it reads at start, every minute, and when a command arrives
// (nudge, at most every 15 s, not awaited), so a turn starts on what was mirrored last.
export interface SyncedRow {
  user_id?: unknown;
  settings: unknown;
  version?: unknown;
  signature?: unknown;
  updated_at: string;
}

export interface SettingsSyncDeps {
  read(): Promise<SyncedRow | null>;
  // Why this row can't be applied (unsigned, not the paired Mac's, older), or null.
  refuse(row: SyncedRow): string | null;
  apply(settings: unknown): string[];
  // A row was applied: remember its version, so an older one put back is refused.
  accepted(row: SyncedRow): void;
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
      seen = row.updated_at;
      const refused = deps.refuse(row);
      // Logged once per row, and nothing of it applied: the worker keeps what it last took from your Mac.
      if (refused) {
        deps.log(`Weft Worker: not taking your synced settings: ${refused}.`);
        return;
      }
      const changed = deps.apply(row.settings);
      deps.accepted(row);
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
