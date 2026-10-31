// The Weft Worker daemon (docs/architecture/weft-worker.md): headless Weft on a host. It heartbeats, asks for the
// commands addressed to it, claims each one (so it can't run twice), and runs it with the same engine the desktop
// runs: `run` (and a web `new_card`) makes a card in the project's checkout and starts its thread, `reply`,
// `answer` and `stop` act on a card it runs. The publisher ships the card and its thread back as they change.
//
// It has no session, so Realtime's row filters would show it nothing. A trigger pings it instead (lib/worker-wake.ts)
// and it asks at once. It still polls: every 30 s to catch a missed ping, and every 3 s while the socket is down.
import { answerBody, answerGrant, newCardBody, replyBody, stopBody, type CloudCommandRow, type GrantScope } from "./cloud-commands";
import type { Card } from "./types";
import { cloneBody, runBody } from "./worker-commands";
import { explainClone, type GithubStatus } from "./worker-github";
import type { Publisher } from "./worker-publish";
import { sealedOf, type Sealed } from "./worker-seal";
import { HEALTHY_AFTER_MS, UPDATE_EVERY_MS } from "./worker-update";
import type { Registry, WorkerStatus } from "./worker-registry";
import type { Tick } from "./worker-update";
import type { WakeHooks } from "./worker-wake";

// The engine, as the daemon uses it (lib/card-starter.ts, lib/runner.ts, lib/store.ts): injected so tests don't run a CLI.
export interface Engine {
  start(body: Record<string, unknown>): Promise<Card>;
  reply(cardId: string, text: string): void;
  answer(cardId: string, allow: boolean, answers: Record<string, string> | undefined, pendingId: string): void;
  // This card / Always on this worker (lib/folder-grant.ts).
  grant(cardId: string, directory: string, scope: GrantScope): void;
  stop(cardId: string): Promise<void>;
  getCard(cardId: string): Card | undefined;
  busy(): boolean;
  // A turn is really running now. `busy` reads the store, where a card a dead daemon left in Running stays there.
  live(): boolean;
}

export interface DaemonDeps {
  reg: Registry;
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
  // Joins the worker's wake-up socket (lib/worker-wake.ts); the returned function leaves it.
  listen?: (hooks: WakeHooks) => () => void;
  // Keeps this box on the newest Weft (lib/worker-update.ts). Absent when it's switched off, or not the worker's clone.
  update?: { tick(hold: () => boolean): Promise<Tick>; build(): Promise<string>; healthy(): void; restart(): void };
  log?: (msg: string) => void;
  pollMs?: number;
  slowPollMs?: number;
  beatMs?: number;
  githubMs?: number;
  updateMs?: number;
  healthyMs?: number;
}

const ERROR_MAX = 300;
const FAST_POLL_MS = 3_000;
// A missed ping costs at most this long. It's the backstop, not the way commands normally arrive.
const SLOW_POLL_MS = 30_000;
// An expired token shows on the worker's row within the hour, or at once when a clone trips over it.
const GITHUB_CHECK_MS = 60 * 60_000;
// A run that names no mode edits files without asking, and still asks before a command it hasn't been allowed.
const DEFAULT_MODE = "acceptEdits";

export function createDaemon(deps: DaemonDeps) {
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const { reg, engine, publisher } = deps;

  function ownCard(cardId: string | undefined): Card {
    const card = cardId ? engine.getCard(cardId) : undefined;
    if (!card || card.role === "copilot") throw new Error("That thread isn't on this worker.");
    return card;
  }

  // Puts the sign-in on the worker's row. Null when GitHub couldn't say: the row keeps what it last showed.
  async function publishGithub(read: () => Promise<GithubStatus | null>): Promise<GithubStatus | null> {
    try {
      const status = await read();
      if (status) await reg.setGithub(status.state, status.account);
      return status;
    } catch (err) {
      log(`Weft Worker: GitHub sign-in: ${(err as Error).message}`);
      return null;
    }
  }

  function sealedToken(command: CloudCommandRow): Sealed {
    const raw: unknown = command.payload;
    const sealed = sealedOf(raw && typeof raw === "object" ? (raw as { token?: unknown }).token : null);
    if (!sealed) throw new Error("That sign-in carries no sealed token.");
    return sealed;
  }

  async function cloneRepo(command: CloudCommandRow) {
    const repo = cloneBody(command);
    if (!repo) throw new Error("That clone names no repo.");
    try {
      await deps.clone(command.folder, repo);
    } catch (err) {
      throw new Error(explainClone(err, repo, await publishGithub(deps.github.status)), { cause: err });
    }
  }

  async function startCard(command: CloudCommandRow): Promise<string> {
    const run = command.kind === "run" ? runBody(command) : null;
    if (command.kind === "run" && !run) throw new Error("That run has no prompt.");
    const { repo, ...fields }: Record<string, unknown> = run ? { ...run } : newCardBody(command);
    if (!fields.prompt) throw new Error("That card has no prompt.");
    const cwd = await deps.checkout(command.folder, typeof repo === "string" ? repo : undefined);
    const card = await engine.start({ ...fields, cwd, permissionMode: run?.permissionMode ?? DEFAULT_MODE });
    publisher.nameFolder(card.id, command.folder);
    publisher.track(card.id);
    // The report names the card, and the database only takes a card this worker has published.
    await publisher.flush();
    return card.id;
  }

  async function act(command: CloudCommandRow): Promise<string | null> {
    const kind: string = command.kind;
    if (kind === "login") {
      await deps.login(sealedToken(command));
      return null;
    }
    if (kind === "github_login") {
      const status = await deps.github.login(sealedToken(command));
      await publishGithub(() => Promise.resolve(status));
      return null;
    }
    if (kind === "clone") {
      await cloneRepo(command);
      return null;
    }
    if (kind === "run" || kind === "new_card") return startCard(command);
    if (kind === "reply") {
      const reply = replyBody(command);
      if (!reply) throw new Error("That reply is empty.");
      engine.reply(ownCard(reply.cardId).id, reply.text);
      return reply.cardId;
    }
    if (kind === "answer") {
      const answer = answerBody(command);
      if (!answer) throw new Error("That answer is empty.");
      const card = ownCard(answer.cardId);
      // Read before the answer clears the request; written after it, so one that has gone leaves no grant behind.
      const grant = answerGrant(answer, card.pending);
      engine.answer(card.id, answer.allow, answer.answers, answer.pendingId);
      if (grant) engine.grant(card.id, grant.directory, grant.scope);
      return answer.cardId;
    }
    if (kind === "stop") {
      const card = ownCard(stopBody(command)?.cardId);
      await engine.stop(card.id);
      return card.id;
    }
    throw new Error("This worker doesn't know that kind of request. Update it with weft-worker update.");
  }

  // Claims one command and says how it went. A claimed command is never retried: a card that was made must not be
  // made twice.
  async function runOne(command: CloudCommandRow) {
    if (!(await reg.claim(command.id))) return;
    log(`Weft Worker: ${command.kind} in ${command.folder}`);
    try {
      const cardId = await act(command);
      await reg.report(command.id, "done", cardId, null);
    } catch (err) {
      const message = (err as Error).message.slice(0, ERROR_MAX);
      log(`Weft Worker: ${command.kind} failed: ${message}`);
      await reg.report(command.id, "failed", null, message).catch(() => {});
    }
  }

  let cloning = 0;
  async function cloneOne(command: CloudCommandRow) {
    cloning += 1;
    await runOne(command).catch((err: unknown) => log(`Weft Worker: ${(err as Error).message}`));
    cloning -= 1;
  }

  // One read of the queue. A clone can take minutes, and a reply or a Stop for a running card shouldn't wait behind it.
  async function pass() {
    try {
      for (const command of await reg.pending()) {
        if (command.kind === "clone") void cloneOne(command);
        else await runOne(command);
      }
    } catch (err) {
      log(`Weft Worker: ${(err as Error).message}`);
    }
  }

  let polling = false;
  let askAgain = false;
  // The clone is changing under the daemon: commands wait in the queue for the code that will run them.
  let updating = false;
  async function poll() {
    if (updating) return;
    // A ping during a pass may name a command that pass already missed, and starting a card can take minutes.
    if (polling) {
      askAgain = true;
      return;
    }
    polling = true;
    await pass();
    polling = false;
    if (askAgain) {
      askAgain = false;
      await poll();
    }
  }

  const status = (): WorkerStatus => (engine.busy() ? "busy" : "online");
  const startedAt = Date.now();
  const beat = async (s: WorkerStatus = status()) => {
    try {
      await reg.heartbeat(s);
      if (Date.now() - startedAt >= (deps.healthyMs ?? HEALTHY_AFTER_MS)) deps.update?.healthy();
    } catch (err) {
      log(`Weft Worker: heartbeat: ${(err as Error).message}`);
    }
  };

  // Puts what this box runs on its row. A database without the function yet only leaves the line off.
  let shown: string | null | undefined;
  async function showBuild(note: string | null) {
    try {
      const build = (await deps.update?.build()) ?? "";
      if (`${build} ${note}` === shown) return;
      await reg.setBuild(build, note);
      shown = `${build} ${note}`;
    } catch (err) {
      log(`Weft Worker: reporting its build: ${(err as Error).message}`);
    }
  }

  const idle = () => !polling && cloning === 0 && !engine.live();

  let checking = false;
  async function checkForUpdate() {
    if (!deps.update || checking) return;
    checking = true;
    try {
      const { restart, note } = await deps.update.tick(() => {
        updating = idle();
        return updating;
      });
      await showBuild(note);
      // Still updating: nothing may start between here and the exit.
      if (restart) {
        deps.update.restart();
        return;
      }
    } catch (err) {
      // Usually no network. The row keeps what it last said, and the next check tries again.
      log(`Weft Worker: update check: ${(err as Error).message}`);
    } finally {
      checking = false;
    }
    if (updating) {
      updating = false;
      void poll();
    }
  }

  // Starts the loops; the returned stop says the worker is offline on the way out.
  function start(): () => Promise<void> {
    void beat();
    void poll();
    void publishGithub(deps.github.status);
    if (deps.update) void showBuild(null);
    // Fast until the socket joins, and whenever it's down. A worker with no socket keeps the fast poll for good.
    const fast = deps.pollMs ?? FAST_POLL_MS;
    let every = fast;
    let pollTimer = setInterval(() => void poll(), every);
    const pace = (ms: number) => {
      if (ms === every) return;
      every = ms;
      clearInterval(pollTimer);
      pollTimer = setInterval(() => void poll(), ms);
    };
    const leave = deps.listen?.({
      ping: () => void poll(),
      // Pings sent while it was down are gone, so ask once now.
      up() {
        pace(deps.slowPollMs ?? SLOW_POLL_MS);
        void poll();
      },
      down: () => pace(fast),
    });
    const beatTimer = setInterval(() => void beat(), deps.beatMs ?? 20_000);
    const githubTimer = setInterval(() => void publishGithub(deps.github.status), deps.githubMs ?? GITHUB_CHECK_MS);
    const updateTimer = setInterval(() => void checkForUpdate(), deps.updateMs ?? UPDATE_EVERY_MS);
    const flushTimer = setInterval(() => void publisher.flush(), 1_000);
    return async () => {
      leave?.();
      clearInterval(pollTimer);
      clearInterval(beatTimer);
      clearInterval(githubTimer);
      clearInterval(updateTimer);
      clearInterval(flushTimer);
      await publisher.flush();
      await beat("offline");
    };
  }

  return { start, poll, runOne, checkForUpdate };
}
