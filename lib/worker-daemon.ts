// The Weft Worker daemon (docs/architecture/weft-worker.md): headless Weft on a host. It heartbeats, asks for the
// commands addressed to it, claims each one (so it can't run twice), and runs it with the same engine the desktop
// runs: `run` (and a web `new_card`) makes a card in the project's checkout and starts its thread, `host` runs any
// verb in lib/host-api on a card it runs, and `reply`, `answer`, `stop` and `mode` run as those verbs too. The publisher ships the card and its thread back as they change.
//
// It has no session, so Realtime's row filters would show it nothing. A trigger pings it instead (lib/worker-wake.ts)
// and it asks at once. It still polls: every 30 s to catch a missed ping, and every 3 s while the socket is down.
//
// The inbox, the poll backstop and the beat are the host core's (lib/host/), shared with the Mac's lib/cloud-inbox.ts:
// this file is the worker's identity (its key: worker_claim and worker_report, lib/host/identity.ts), its kind table
// (lib/worker-kinds.ts), and what only a worker does: recover after a restart, keep itself updated, show its GitHub.
import type { CloudCommandRow, GrantScope } from "./cloud-commands";
import type { Card } from "./types";
import type { HostVerb } from "./host-api";
import type { HostDone } from "./host-command";
import { createBeat } from "./host/beat";
import { keyLine } from "./host/identity";
import { createInbox, startPolling, type Connection } from "./host/inbox";
import type { ScreenInput } from "./worker-commands";
import type { GithubStatus } from "./worker-github";
import { publishGithub, workerDispatch } from "./worker-kinds";
import type { Publisher } from "./worker-publish";
import type { Sealed } from "./worker-seal";
import { HEALTHY_AFTER_MS } from "./worker-update";
import { createUpdateLoop, type Holder } from "./worker-update-loop";
import type { Registry, WorkerStatus } from "./worker-registry";
import type { Tick } from "./worker-update";
import type { WakeHooks } from "./worker-wake";
import type { Presence, PresenceHooks } from "./worker-presence";
import type { Recovered } from "./worker-recover";
import type { WorkerWiden } from "./worker-widen";

// The engine, as the daemon uses it (lib/card-starter.ts, lib/runner.ts, lib/store.ts): injected so tests don't run a CLI.
export interface Engine {
  start(body: Record<string, unknown>): Promise<Card>;
  // One verb of lib/host-api, run in this process (runVerb): a reply, an answer, a stop, a mode and the rest.
  host(verb: HostVerb, args: Record<string, unknown>): Promise<unknown>;
  // Puts a verb's large result in the blob store and answers its sha (lib/host-result.ts); absent, only small ones go.
  carry?: (json: string) => Promise<string>;
  // Brings the files a command's text pastes onto this box and points the text at them (lib/attachment-transfer.ts).
  receive(text: string, payload: unknown): Promise<string>;
  // This card / Always on this worker (lib/folder-grant.ts).
  grant(cardId: string, directory: string, scope: GrantScope): void;
  // A tap or swipe on the device a card is watching (lib/simulator-input.ts), or the pane starting its stream.
  input(input: ScreenInput, cardId: string): Promise<unknown>;
  // Local Simulator mode: which Mac this card's device tools go to, null for this box's own (lib/worker-device.ts).
  setQa(cardId: string, device: string | null): void;
  getCard(cardId: string): Card | undefined;
  // A turn is really running now, in a session this process holds (a card waiting on a permission counts).
  live(): boolean;
  // Those same cards, for the row while they hold an update.
  holding(): Holder[];
  // The cards the last daemon died on, their threads tidied (lib/worker-recover.ts).
  recover(): Recovered;
  // Carries on the turns it can (lib/resume.ts).
  resume(): void;
}

export interface DaemonDeps {
  reg: Registry;
  // The account that owns this worker (its config's ownerUser): the author a command needs for dev.open.
  owner?: string;
  engine: Engine;
  publisher: Publisher;
  // The checkout a command's folder names, cloned when it isn't there (lib/worker-paths.ts).
  checkout(folder: string, repo: string | undefined): Promise<string>;
  // Opens a sealed Claude token and signs this box's CLIs in with it (scripts/weft-worker.ts).
  login(sealed: Sealed): Promise<void>;
  // Puts a repo in the folder a clone command names (lib/worker-paths.ts cloneProject).
  clone(folder: string, repo: string): Promise<void>;
  // Signs this box's git in to GitHub, and says what it's signed in as (lib/worker-github.ts).
  github: { login: (sealed: Sealed) => Promise<GithubStatus>; status: () => Promise<GithubStatus | null> };
  // Opens a sealed `secret_use` and hands its values to the card's waiting mcp__secrets__run (lib/worker-secret-asks.ts).
  secretUse?: (command: CloudCommandRow) => string;
  // Joins the worker's wake-up socket (lib/worker-wake.ts); the returned function leaves it.
  listen?: (hooks: WakeHooks) => () => void;
  // Joins the worker's presence topic (lib/worker-presence.ts), so the row is written every few minutes, not every 20 s.
  presence?: (hooks: PresenceHooks) => Presence;
  // Joins the topic a push to main pings (lib/worker-wake.ts listenForPushes).
  listenForPushes?: (hooks: WakeHooks) => () => void;
  // Runs once recovery has settled (published, resumed, or failed): the timed work that may start a turn, like Send
  // later's scheduler, so a message that fell due while the worker was down can't race a card about to be resumed.
  onRecovered?: () => void;
  // Opens a session line from a sealed offer (lib/host-line.ts). `run` is the host command's own path (lib/host/dispatch.ts
  // via lib/worker-kinds.ts), so a verb over the line passes exactly the checks it would over the relay.
  line?: (sealed: Sealed, run: (payload: unknown) => Promise<HostDone>) => Promise<void>;
  // Signed widening (lib/worker-widen.ts): its pins, nonces and project folders. Absent, every widening stays refused.
  widen?: WorkerWiden;
  // Calls back when a card changes, so a held update can go the moment the last one ends.
  onCardChange?: (listener: () => void) => () => void;
  // Keeps this box on the newest Weft (lib/worker-update.ts). Absent when it's switched off, or not the worker's clone.
  update?: { tick(hold: () => boolean): Promise<Tick>; build(): Promise<string>; healthy(): void; restart(): void };
  // A standing warning for the worker's row beside any update note: the browser running without its sandbox
  // (lib/worker-chromium.ts browserSandboxNote).
  browserNote?: string | null;
  log?: (msg: string) => void;
  pollMs?: number;
  slowPollMs?: number;
  beatMs?: number;
  slowBeatMs?: number;
  githubMs?: number;
  updateMs?: number;
  pushedUpdateMs?: number;
  minFetchMs?: number;
  firstFetchMs?: number;
  healthyMs?: number;
}

const FAST_POLL_MS = 3_000;
// A missed ping costs at most this long. It's the backstop, not the way commands normally arrive.
const SLOW_POLL_MS = 30_000;
// An expired token shows on the worker's row within the hour, or at once when a clone trips over it.
const GITHUB_CHECK_MS = 60 * 60_000;
// Run beside the queue: a clone can take minutes, and a tap shouldn't wait behind a card that's starting (the person
// who made it is watching the screen).
const ASIDE = new Set(["clone", "input", "qa", "line"]);

export function createDaemon(deps: DaemonDeps) {
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const { reg, engine, publisher } = deps;
  let updates: ReturnType<typeof createUpdateLoop> | null = null;
  const github = (read: () => Promise<GithubStatus | null>) => publishGithub(deps, log, read);

  // Not awaited: this pass counts as busy, so the check holds until the pass has reported this command.
  function askForUpdate(): null {
    if (!updates) throw new Error("This worker doesn't update itself: auto-update is off, or it isn't running from its own clone.");
    void updates.check();
    return null;
  }

  const conn: Connection = { line: keyLine(reg), dispatch: workerDispatch(deps, { log, askForUpdate, updating: () => updates?.updating() ?? false }) };
  let recovering: Promise<void> | null = null;
  const inbox = createInbox({
    // Commands wait for recovery: a reply queued while the worker was down must not land on a card about to resume.
    connect: () => (recovering ? recovering.then(() => conn) : conn),
    aside: (command) => ASIDE.has(command.kind),
    // The clone is changing under the daemon: commands wait in the queue for the code that will run them.
    paused: () => updates?.updating() ?? false,
    after: () => updates?.changed(),
    claimed: (command) => log(`Weft Worker: ${command.kind} in ${command.folder}`),
    failed: (command, error) => log(`Weft Worker: ${command.kind} failed: ${error}`),
    log: (msg) => log(`Weft Worker: ${msg}`),
  });
  const poll = () => inbox.poll();
  // Claims one command and says how it went.
  const runOne = (command: CloudCommandRow) => inbox.run(conn, command);

  // Tells the cloud what became of the cards the last daemon died on, then carries on the ones it can. Publishing comes
  // first so a turn that can't start still shows as stopped. Commands wait for this: a reply queued while the worker was
  // down must not land on a card that's about to be resumed.
  async function recover() {
    try {
      const { cut, stopped } = engine.recover();
      cut.forEach((id) => publisher.track(id));
      stopped.forEach((id) => publisher.touch(id));
      if (cut.length) log(`Weft Worker: ${cut.length} turn(s) cut off by the last restart`);
      await publisher.flush();
      engine.resume();
    } catch (err) {
      log(`Weft Worker: recovering cards: ${(err as Error).message}`);
    }
  }

  const status = (): WorkerStatus => (engine.live() ? "busy" : "online");
  const startedAt = Date.now();
  // An update counts as healthy once it has stayed up a while and its last heartbeat reached the database.
  const beat = createBeat({
    heartbeat: reg.heartbeat,
    status,
    after(landed) {
      if (!landed) return;
      if (Date.now() - startedAt >= (deps.healthyMs ?? HEALTHY_AFTER_MS)) deps.update?.healthy();
      updates?.changed();
    },
    presence: deps.presence,
    log,
    beatMs: deps.beatMs,
    slowBeatMs: deps.slowBeatMs,
  });

  // Puts what this box runs on its row. A database without the function yet only leaves the line off.
  let shown: string | null | undefined;
  async function showBuild(updateNote: string | null) {
    const note = [updateNote, deps.browserNote].filter(Boolean).join(" ") || null;
    try {
      const build = (await deps.update?.build()) ?? "";
      if (`${build} ${note}` === shown) return;
      await reg.setBuild(build, note);
      shown = `${build} ${note}`;
    } catch (err) {
      log(`Weft Worker: reporting its build: ${(err as Error).message}`);
    }
  }

  const idle = () => inbox.idle() && !engine.live();

  updates = deps.update
    ? createUpdateLoop({
        update: deps.update,
        idle,
        holders: () => engine.holding(),
        show: showBuild,
        release: () => void poll(),
        log,
        everyMs: deps.updateMs,
        pushedEveryMs: deps.pushedUpdateMs,
        minFetchMs: deps.minFetchMs,
        firstFetchMs: deps.firstFetchMs,
      })
    : null;

  // Starts the loops; the returned stop says the worker is offline on the way out.
  function start(): () => Promise<void> {
    recovering = recover().finally(() => {
      recovering = null;
      deps.onRecovered?.();
    });
    beat.start();
    void poll();
    void github(deps.github.status);
    if (deps.update || deps.browserNote) void showBuild(null);
    // Fast until the socket joins, and whenever it's down. A worker with no socket keeps the fast poll for good.
    const stopPolling = startPolling(() => void poll(), { fastMs: deps.pollMs ?? FAST_POLL_MS, slowMs: deps.slowPollMs ?? SLOW_POLL_MS, listen: deps.listen });
    const githubTimer = setInterval(() => void github(deps.github.status), deps.githubMs ?? GITHUB_CHECK_MS);
    updates?.start();
    const leavePushes = updates && deps.listenForPushes?.(updates);
    const leaveCards = updates && deps.onCardChange?.(updates.changed);
    const flushTimer = setInterval(() => void publisher.flush(), 1_000);
    return async () => {
      stopPolling();
      leavePushes?.();
      leaveCards?.();
      updates?.stop();
      clearInterval(githubTimer);
      clearInterval(flushTimer);
      await publisher.flush();
      await beat.stop();
    };
  }

  return { start, poll, runOne, checkForUpdate: () => updates?.check() };
}
