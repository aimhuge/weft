// A worker's open secret asks, in memory only, and the daemon's handler for the `secret_use` that answers one
// (docs/architecture/project-hosts.md#secrets-on-a-worker-h8-the-per-use-seal-as-built). An ask is keyed by a one-time
// nonce and bound to its card, command, names, environment and expiry. A secret_use is believed only when it names an
// open ask on the same card, opens under that ask's purpose, and repeats it exactly before the expiry. A refusal leaves
// the ask open, so a row that can't open can't burn the real one; a delivery closes it, so a replay finds nothing.
import type { CloudCommandRow } from "./cloud-commands";
import { globalSingleton } from "./global-singleton";
import { openedUse, sameNames, secretUseBody, secretUseMessage, secretUsePurpose } from "./secret-use";
import { macSigned, type MacKeys } from "./worker-mac-keys";
import type { Sealed } from "./worker-seal";
import { devEnvPurpose } from "./worker-vault-wire";

interface Ask {
  cardId: string;
  command: string;
  names: string[];
  environment: string;
  expiresAt: number;
  // A dev server's ask (lib/worker-dev-env.ts): sealed for devEnvPurpose, and it takes whatever names the vault's
  // development set has, since the worker can't know them before the Mac answers. A run's names are exact.
  dev?: boolean;
  // The vault the checkout's remote names (github:owner/name), where a kept value is looked up (lib/worker-kept-vault.ts).
  repo?: string;
  resolve: (values: Record<string, string>) => void;
  reject: (err: Error) => void;
}

const asks = () => globalSingleton("__weftWorkerSecretAsks", () => new Map<string, Ask>());

export interface OpenAsk {
  values: Promise<Record<string, string>>;
  drop: () => void;
}

// Opens an ask under a fresh nonce. drop() closes it, whether or not it was answered. One per card at a time, so a
// thread can't stack approvals on the user's Mac.
export function openAsk(nonce: string, ask: Omit<Ask, "resolve" | "reject">): OpenAsk {
  if ([...asks().values()].some((open) => open.cardId === ask.cardId)) throw new Error("This card already has a secret ask waiting on your Mac. Wait for its answer before asking again.");
  let resolve!: Ask["resolve"];
  let reject!: Ask["reject"];
  const values = new Promise<Record<string, string>>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  // A rejection nobody is waiting for yet mustn't surface as unhandled.
  values.catch(() => {});
  asks().set(nonce, { ...ask, resolve, reject });
  return { values, drop: () => void asks().delete(nonce) };
}

export const openAsks = () => asks().size;

// The row must be signed by the Mac this box was paired with (lib/worker-mac-keys.ts): no key off the network is ever
// trusted, so a session that seals and signs its own row before the real Touch ID gets nothing. Throws otherwise.
function checkMac(body: NonNullable<ReturnType<typeof secretUseBody>>, macs: MacKeys): void {
  const trusted = macs.pinned();
  if (!trusted.length) throw new Error("This worker trusts no Mac for secrets: it was enrolled by token. Pair it from Settings → Devices → Add a worker to use secrets on it.");
  if (!body.mac) throw new Error("That secret use isn't signed by a Mac.");
  if (!trusted.includes(body.mac.key)) throw new Error("That secret use is signed by a Mac this worker wasn't paired with.");
  if (!macSigned(body.mac.key, secretUseMessage(body.cardId, body.nonce, body.sealed), body.mac.sig)) throw new Error("That secret use's Mac signature doesn't check out.");
}

// The values a row carries, once it opens under this ask's purpose and repeats it exactly before the expiry; throws why not.
function openChecked(body: NonNullable<ReturnType<typeof secretUseBody>>, ask: Ask, open: (sealed: Sealed, purpose: string) => string, now: number) {
  let text: string;
  try {
    text = open(body.sealed, (ask.dev ? devEnvPurpose : secretUsePurpose)(ask.cardId, body.nonce, ask.command));
  } catch {
    throw new Error("That secret use wasn't sealed to this worker for this card's command.");
  }
  const use = openedUse(text);
  if (!use || use.card !== ask.cardId || use.nonce !== body.nonce) throw new Error("That secret use is for another ask.");
  if (use.command !== ask.command) throw new Error("That secret use is for another command.");
  if ((!ask.dev && !sameNames(use.names, ask.names)) || use.environment !== ask.environment) throw new Error("That secret use names other secrets.");
  const kept = use.kept ?? {};
  if (Object.keys(kept).some((name) => name in use.values)) throw new Error("That secret use names a secret twice.");
  if (!sameNames([...Object.keys(use.values), ...Object.keys(kept)], use.names)) throw new Error("That secret use doesn't carry the values it names.");
  if (now > use.expiresAt) throw new Error("That secret use came after its ask expired.");
  return { values: use.values, kept, environment: use.environment };
}

// Opens the kept values a Mac-signed secret_use names from this box's own copy (lib/worker-kept-vault.ts open).
export type KeptOpener = (repo: string, environment: string, want: Record<string, number>) => Record<string, string>;

function withKept(opened: ReturnType<typeof openChecked>, ask: Ask, keptOpen: KeptOpener | undefined): Record<string, string> {
  if (!Object.keys(opened.kept).length) return opened.values;
  if (!ask.repo || !keptOpen) throw new Error("Your Mac said to use this worker's kept copy, but it keeps none here. Ask again: your Mac will send the values.");
  return { ...opened.values, ...keptOpen(ask.repo, opened.environment, opened.kept) };
}

// The daemon's `secret_use`: hands the values to the waiting tool and returns its card, or throws why it won't. A value
// the Mac approved from this box's kept copy is opened here; one that can't be fails the ask at once.
export function deliverSecretUse(command: Pick<CloudCommandRow, "payload">, open: (sealed: Sealed, purpose: string) => string, macs: MacKeys, now = Date.now(), keptOpen?: KeptOpener): string {
  const body = secretUseBody(command);
  if (!body) throw new Error("That secret use is empty.");
  checkMac(body, macs);
  const ask = asks().get(body.nonce);
  if (!ask) throw new Error("That secret use answers no open ask: it was already used, it expired, or it was never asked for.");
  if (ask.cardId !== body.cardId) throw new Error("That secret use is for another card.");
  if (now > ask.expiresAt) {
    asks().delete(body.nonce);
    ask.reject(new Error("The approval came too late: the ask had expired. Ask again."));
    throw new Error("That secret use came after its ask expired.");
  }
  const opened = openChecked(body, ask, open, now);
  asks().delete(body.nonce);
  let values: Record<string, string>;
  try {
    values = withKept(opened, ask, keptOpen);
  } catch (err) {
    ask.reject(err as Error);
    throw err;
  }
  ask.resolve(values);
  return ask.cardId;
}
