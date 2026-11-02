// A Weft Worker's kind table (lib/worker-daemon.ts runs it through the host core's inbox, lib/host/inbox.ts): `run`
// (and a web `new_card`) makes a card in the project's checkout and starts its thread; `login` and `github_login` open a
// sealed sign-in; `clone` puts a repo in a folder; `update` asks for the update check; and the card kinds
// (lib/worker-card-commands.ts) act on a card it runs; `line` opens a session line (lib/host-line.ts); `secret_use`
// hands a sealed answer to a card's waiting secret run. Each returns the card it made or touched, or null.
import { NEW_CARD_MODES, newCardBody, type CloudCommandRow, type NewCardMode } from "./cloud-commands";
import { networkStartMode } from "./cloud-new-card-mode";
import { dispatcher, type KindTable } from "./host/dispatch";
import type { ListVerb } from "@weft/client";
import type { HostArgs, HostDone } from "./host-command";
import { createCardCommands } from "./worker-card-commands";
import { cloneBody, runBody } from "./worker-commands";
import type { DaemonDeps } from "./worker-daemon";
import { explainClone, type GithubStatus } from "./worker-github";
import { sentByWorker, WORKER_CARD_MODE } from "./worker-origin";
import { sealedOf, type Sealed } from "./worker-seal";
import type { Card, PermissionMode } from "./types";

const UNKNOWN_KIND = "This worker doesn't know that kind of request. Update it with weft-worker update.";
// A run that names no mode edits files without asking, and still asks before a command it hasn't been allowed.
const DEFAULT_MODE = "acceptEdits";

// The mode a new card off the network starts in here, by the rule a Mac's does (lib/cloud-new-card-mode.ts): never
// bypassPermissions, plan as default (the card maker has no plan mode and reads one it doesn't know as this box's own
// default, which may skip prompts), any other mode it doesn't know refused, and none named the run default above. A
// worker takes acceptEdits and auto from the web (CARD_MODES), so nothing else is refused.
export function workerStartMode(named: unknown): Promise<PermissionMode> {
  if (named !== undefined && !NEW_CARD_MODES.includes(named as NewCardMode)) return Promise.reject(new Error("That mode can't be set on a worker."));
  return networkStartMode(named as NewCardMode | undefined, { defaultMode: () => DEFAULT_MODE, refusal: () => Promise.resolve(null) });
}

// A card another of the user's workers sent starts in `default`, whatever it names (lib/worker-origin.ts); any other
// takes workerStartMode's rule.
const startMode = (command: CloudCommandRow, named: unknown): Promise<PermissionMode> =>
  sentByWorker(command.payload) ? Promise.resolve(WORKER_CARD_MODE) : workerStartMode(named);

export interface KindContext {
  log: (msg: string) => void;
  // Asks the update loop for a check, or throws when this worker doesn't update itself.
  askForUpdate(): null;
  // The clone is changing under the daemon: a verb over a line waits for it like a row does, so it's refused meanwhile.
  updating?(): boolean;
}

const UPDATING = "This worker is updating itself. Try again in a moment.";

// A verb that came over a session line, with the bookkeeping the inbox gives a row: refused while the worker updates
// itself, and logged with its card and outcome.
async function lineVerb(run: () => Promise<HostDone>, payload: unknown, ctx: KindContext): Promise<HostDone> {
  const { verb, args } = (payload && typeof payload === "object" ? payload : {}) as { verb?: unknown; args?: { id?: unknown } };
  const what = `line ${String(verb)} on ${String(args?.id)}`;
  try {
    if (ctx.updating?.()) throw new Error(UPDATING);
    const done = await run();
    ctx.log(`Weft Worker: ${what}: done`);
    return done;
  } catch (err) {
    ctx.log(`Weft Worker: ${what} failed: ${(err as Error).message}`);
    throw err;
  }
}

// Puts the sign-in on the worker's row. Null when GitHub couldn't say: the row keeps what it last showed.
export async function publishGithub(deps: Pick<DaemonDeps, "reg">, log: (msg: string) => void, read: () => Promise<GithubStatus | null>): Promise<GithubStatus | null> {
  try {
    const status = await read();
    if (status) await deps.reg.setGithub(status.state, status.account);
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

// cron.* and webhook.* from the Mac's ⏰ and 🪝 drawers, on this worker's own crons and webhooks (lib/host-api/lists.ts),
// past remoteRefusal. A run asked for from the network starts in the mode a new card from it would (workerStartMode:
// never bypassPermissions, plan as default), whatever mode the thread that made the cron had; it answers the run's card.
// A new prompt is new work on every fire after it, so the cron keeps only the mode a card from the network may start in:
// one made in bypassPermissions (or a mode the web can't name) drops to `default` rather than run the new words unasked.
export async function listVerb(engine: Pick<DaemonDeps["engine"], "host">, verb: ListVerb, args: HostArgs): Promise<string | null> {
  if (verb !== "cron.run" && !(verb === "cron.update" && typeof (args.patch as { prompt?: unknown }).prompt === "string")) {
    await engine.host(verb, args);
    return null;
  }
  const { getCron } = await import("./cron-store");
  const cron = getCron(args.id);
  if (!cron) throw new Error("No such cron.");
  if (verb === "cron.update") {
    const permissionMode = await workerStartMode(cron.permissionMode).catch((): PermissionMode => "default");
    await engine.host("cron.update", { ...args, permissionMode });
    return null;
  }
  const permissionMode = await workerStartMode(cron.permissionMode);
  const { card } = (await engine.host("cron.run", { id: cron.id, permissionMode })) as { card: Card };
  return card.id;
}

export function workerKinds(deps: DaemonDeps, ctx: KindContext): KindTable {
  const { engine, publisher } = deps;
  const github = (read: () => Promise<GithubStatus | null>) => publishGithub(deps, ctx.log, read);

  async function clone(command: CloudCommandRow) {
    const repo = cloneBody(command);
    if (!repo) throw new Error("That clone names no repo.");
    try {
      await deps.clone(command.folder, repo);
    } catch (err) {
      throw new Error(explainClone(err, repo, await github(deps.github.status)), { cause: err });
    }
    return null;
  }

  async function startCard(command: CloudCommandRow): Promise<string> {
    const run = command.kind === "run" ? runBody(command) : null;
    if (command.kind === "run" && !run) throw new Error("That run has no prompt.");
    const { repo, start, ...fields }: Record<string, unknown> = run ? { ...run } : newCardBody(command);
    if (typeof fields.prompt !== "string" || !fields.prompt) throw new Error("That card has no prompt.");
    if (start === false) throw new Error("A worker has no Backlog yet. Start the thread instead.");
    fields.prompt = await engine.receive(fields.prompt, command.payload);
    const cwd = await deps.checkout(command.folder, typeof repo === "string" ? repo : undefined);
    return published(command, await engine.start({ ...fields, cwd, permissionMode: await startMode(command, run?.permissionMode ?? fields.permissionMode) }));
  }

  async function published(command: CloudCommandRow, card: Card): Promise<string> {
    publisher.nameFolder(card.id, command.folder);
    publisher.track(card.id);
    // The report names the card, and the database only takes a card this worker has published.
    await publisher.flush();
    return card.id;
  }

  // card.create (lib/host-api/card-create.ts): the board's id and fields, in the row's checkout. The args passed
  // remoteRefusal, so they name no folder, agent or skipped prompts; the mode is workerStartMode's.
  async function create(command: CloudCommandRow, args: Record<string, unknown>): Promise<string> {
    const permissionMode = await workerStartMode(args.permissionMode);
    const cwd = await deps.checkout(command.folder, undefined);
    return published(command, await engine.start({ ...args, cwd, permissionMode }));
  }

  const cards = createCardCommands(engine, create, (verb, args) => listVerb(engine, verb, args), deps.owner);
  return {
    async login(command) {
      await deps.login(sealedToken(command));
      return null;
    },
    async github_login(command) {
      const status = await deps.github.login(sealedToken(command));
      await github(() => Promise.resolve(status));
      return null;
    },
    clone,
    run: startCard,
    new_card: startCard,
    update: () => ctx.askForUpdate(),
    ...cards,
    // A session line's sealed offer (lib/host-line.ts): its verbs run through this table's own `host`, so they pass
    // exactly the checks a `host` command does (CardRules, remoteRefusal).
    async line(command) {
      if (!deps.line) throw new Error("This worker doesn't open lines yet. Update it with weft-worker update.");
      const raw: unknown = command.payload;
      const sealed = sealedOf(raw && typeof raw === "object" ? (raw as { sealed?: unknown }).sealed : null);
      if (!sealed) throw new Error("That line carries no sealed offer.");
      await deps.line(sealed, (payload) => lineVerb(() => cards.host({ ...command, kind: "host", payload } as CloudCommandRow), payload, ctx));
      return null;
    },
    // The Mac's sealed answer to a card's mcp__secrets__run (lib/worker-secret-asks.ts); an old wiring without it can't open one.
    ...(deps.secretUse ? { secret_use: deps.secretUse } : {}),
  };
}

export const workerDispatch = (deps: DaemonDeps, ctx: KindContext) => dispatcher(workerKinds(deps, ctx), UNKNOWN_KIND);
