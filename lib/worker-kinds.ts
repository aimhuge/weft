// A Weft Worker's kind table (lib/worker-daemon.ts runs it through the host core's inbox, lib/host/inbox.ts): `run`
// (and a web `new_card`) makes a card in the project's checkout and starts its thread; `login` and `github_login` open a
// sealed sign-in; `clone` puts a repo in a folder; `update` asks for the update check; and the card kinds
// (lib/worker-card-commands.ts) act on a card it runs. Each returns the card it made or touched, or null.
import { newCardBody, type CloudCommandRow } from "./cloud-commands";
import { dispatcher, type KindTable } from "./host/dispatch";
import { createCardCommands } from "./worker-card-commands";
import { cloneBody, runBody } from "./worker-commands";
import type { DaemonDeps } from "./worker-daemon";
import { explainClone, type GithubStatus } from "./worker-github";
import { sealedOf, type Sealed } from "./worker-seal";

const UNKNOWN_KIND = "This worker doesn't know that kind of request. Update it with weft-worker update.";
// A run that names no mode edits files without asking, and still asks before a command it hasn't been allowed.
const DEFAULT_MODE = "acceptEdits";

export interface KindContext {
  log: (msg: string) => void;
  // Asks the update loop for a check, or throws when this worker doesn't update itself.
  askForUpdate(): null;
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
    const { repo, ...fields }: Record<string, unknown> = run ? { ...run } : newCardBody(command);
    if (typeof fields.prompt !== "string" || !fields.prompt) throw new Error("That card has no prompt.");
    fields.prompt = await engine.receive(fields.prompt, command.payload);
    const cwd = await deps.checkout(command.folder, typeof repo === "string" ? repo : undefined);
    const card = await engine.start({ ...fields, cwd, permissionMode: run?.permissionMode ?? DEFAULT_MODE });
    publisher.nameFolder(card.id, command.folder);
    publisher.track(card.id);
    // The report names the card, and the database only takes a card this worker has published.
    await publisher.flush();
    return card.id;
  }

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
    ...createCardCommands(engine),
  };
}

export const workerDispatch = (deps: DaemonDeps, ctx: KindContext) => dispatcher(workerKinds(deps, ctx), UNKNOWN_KIND);
