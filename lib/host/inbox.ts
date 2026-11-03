// One host's command inbox (docs/architecture/project-hosts.md#phases, H5): the loop a Mac (lib/cloud-inbox.ts) and a
// Weft Worker (lib/worker-daemon.ts) both run. A pass asks who this host is (connect), reads its pending commands,
// claims each one, runs it through the host's kind table (lib/host/dispatch.ts) and reports how it went. What differs
// per host is injected: the identity and transport (lib/host/identity.ts), the table, which kinds run beside the
// queue, and the log.
//
// Passes are single-flight: a wake-up during one asks for one more straight after it, never one per wake-up. A claim
// holds a lease the host renews while it runs the command (renew, from its beat); a pass first requeues the host's own
// expired claims of verbs safe to run twice (lib/host/lease.ts). Any other claimed command is never retried: a card
// that was made must not be made twice.
import type { CloudCommandRow } from "../cloud-commands";
import type { WakeHooks } from "../worker-wake";
import { doneOutcome, failedOutcome, type CommandLine, type Done } from "./identity";
import { createLeases, newLeaseState, type LeaseState } from "./lease";

// One pass's identity: its line to cloud_commands, and the kind table it runs a claimed command through (throws to
// fail it). A Mac's is per signed-in account, so it's read afresh each pass.
export interface Connection {
  line: CommandLine;
  dispatch: (command: CloudCommandRow) => Promise<Done>;
}

// The single-flight state: a pass running, one owed, commands running aside. A host that must outlive a module reload
// (the Mac's Next server) keeps it in a global and hands it in, so its closures stay fresh while the flags carry over.
export interface InboxState {
  polling: boolean;
  again: boolean;
  aside: number;
  // The commands it holds and when it last renewed or reclaimed; optional, so a state kept from before a reload works.
  leases?: LeaseState;
}

export const newInboxState = (): InboxState => ({ polling: false, again: false, aside: 0, leases: newLeaseState() });

export interface InboxDeps {
  // This host's connection for one pass, or null when it has no identity now (signed out). A host that has it at hand
  // returns it as is, so the pass reads the queue in the same tick it started.
  connect(): Connection | null | Promise<Connection | null>;
  // A kind that runs beside the queue rather than in it (a worker's clone, tap or QA switch).
  aside?(command: CloudCommandRow): boolean;
  // Holds every pass while true (a worker's update swapping its code).
  paused?(): boolean;
  // After each pass, and after a command run aside ends.
  after?(): void;
  // Said once a command is claimed, and when one fails.
  claimed?(command: CloudCommandRow): void;
  failed?(command: CloudCommandRow, error: string): void;
  log(msg: string): void;
  state?: InboxState;
}

export function createInbox(deps: InboxDeps) {
  const st = deps.state ?? newInboxState();
  const leases = createLeases((st.leases ??= newLeaseState()), (msg) => deps.log(msg));

  async function runOne({ line, dispatch }: Connection, command: CloudCommandRow) {
    if (!(await line.claim(command.id))) return;
    leases.hold(command.id);
    deps.claimed?.(command);
    try {
      await line.report(command.id, doneOutcome(await dispatch(command)));
    } catch (err) {
      const outcome = failedOutcome(command, err);
      deps.failed?.(command, outcome.error);
      await line.report(command.id, outcome).catch(() => {});
    } finally {
      leases.drop(command.id);
    }
  }

  async function runAside(conn: Connection, command: CloudCommandRow) {
    st.aside += 1;
    await runOne(conn, command).catch((err: unknown) => deps.log((err as Error).message));
    st.aside -= 1;
    deps.after?.();
  }

  async function pass() {
    try {
      const got = deps.connect();
      const conn = got instanceof Promise ? await got : got;
      if (!conn) return;
      await leases.reclaim(conn.line);
      for (const command of await conn.line.pending()) {
        if (deps.aside?.(command)) void runAside(conn, command);
        else await runOne(conn, command);
      }
    } catch (err) {
      deps.log((err as Error).message);
    }
  }

  async function poll(): Promise<void> {
    if (deps.paused?.()) return;
    if (st.polling) {
      st.again = true;
      return;
    }
    st.polling = true;
    await pass();
    st.polling = false;
    if (st.again) {
      st.again = false;
      await poll();
    }
    deps.after?.();
  }

  // Claims and runs one command the caller already read.
  const run = (conn: Connection, command: CloudCommandRow) => runOne(conn, command);
  // Nothing in flight: no pass, no command aside.
  const idle = () => !st.polling && st.aside === 0;
  // Renews the leases of what this host is running; the beat calls it each tick, and it asks at most once a minute.
  const renew = (line: CommandLine) => leases.renew(line);

  return { poll, run, idle, renew };
}

// The poll backstop under the wake-ups: every fastMs until a wake-up socket joins, slowMs while it's up, back to fast
// when it drops. A host with no socket (listen absent, or one that never joins) keeps the fast pace for good. The
// returned function leaves the socket and stops the timer.
export function startPolling(poll: () => void, opts: { fastMs: number; slowMs?: number; listen?: (hooks: WakeHooks) => () => void }): () => void {
  let every = opts.fastMs;
  let timer = setInterval(poll, every);
  const pace = (ms: number) => {
    if (ms === every) return;
    every = ms;
    clearInterval(timer);
    timer = setInterval(poll, ms);
  };
  const leave = opts.listen?.({
    ping: poll,
    // Pings sent while it was down are gone, so ask once now.
    up() {
      pace(opts.slowMs ?? opts.fastMs);
      poll();
    },
    down: () => pace(opts.fastMs),
  });
  return () => {
    leave?.();
    clearInterval(timer);
  };
}
