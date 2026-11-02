// A Weft Worker's kind table (lib/worker-daemon.ts runs it through the host core's inbox, lib/host/inbox.ts): `run`
// (and a web `new_card`) makes a card in the project's checkout and starts its thread; `login` and `github_login` open a
// sealed sign-in; `clone` puts a repo in a folder; `update` asks for the update check; and the card kinds
// (lib/worker-card-commands.ts) act on a card it runs; `line` opens a session line (lib/host-line.ts); `secret_use`
// hands a sealed answer to a card's waiting secret run. Each returns the card it made or touched, or null.
import { newCardBody, type CloudCommandRow } from "./cloud-commands";
import { dispatcher, type KindTable } from "./host/dispatch";
import type { HostDone } from "./host-command";
import { createCardCommands } from "./worker-card-commands";
import { cloneBody, runBody } from "./worker-commands";
import type { DaemonDeps } from "./worker-daemon";
import { explainClone, type GithubStatus } from "./worker-github";
import { sealedOf, type Sealed } from "./worker-seal";
import type { Card } from "./types";

const UNKNOWN_KIND = "This worker doesn't know that kind of request. Update it with weft-worker update.";
// A run that names no mode edits files without asking, and still asks before a command it hasn't been allowed.
const DEFAULT_MODE = "acceptEdits";

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
    return published(command, await engine.start({ ...fields, cwd, permissionMode: run?.permissionMode ?? fields.permissionMode ?? DEFAULT_MODE }));
  }

  async function published(command: CloudCommandRow, card: Card): Promise<string> {
    publisher.nameFolder(card.id, command.folder);
    publisher.track(card.id);
    // The report names the card, and the database only takes a card this worker has published.
    await publisher.flush();
    return card.id;
  }

  // card.create (lib/host-api/card-create.ts): the board's id and fields, in the row's checkout. The args passed
  // remoteRefusal, so they name no folder, agent or skipped prompts; a mode left out is a run's default.
  async function create(command: CloudCommandRow, args: Record<string, unknown>): Promise<string> {
    const cwd = await deps.checkout(command.folder, undefined);
    return published(command, await engine.start({ ...args, cwd, permissionMode: args.permissionMode ?? DEFAULT_MODE }));
  }

  const cards = createCardCommands(engine, create);
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
