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

interface Ask {
  cardId: string;
  command: string;
  names: string[];
  environment: string;
  expiresAt: number;
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

// The key of the Mac that signed the row, when this worker trusts it (lib/worker-mac-keys.ts): a pinned key, or, before
// any is pinned, the key it names (pinned once the whole delivery checks out). Throws otherwise.
function signingMac(body: NonNullable<ReturnType<typeof secretUseBody>>, macs: MacKeys): string {
  if (!body.mac) throw new Error("That secret use isn't signed by a Mac.");
  const trusted = macs.pinned();
  if (trusted.length && !trusted.includes(body.mac.key)) throw new Error("That secret use is signed by a Mac this worker doesn't trust. If you moved to a new Mac, run weft-worker forget-macs on the box.");
  if (!macSigned(body.mac.key, secretUseMessage(body.cardId, body.nonce, body.sealed), body.mac.sig)) throw new Error("That secret use's Mac signature doesn't check out.");
  return body.mac.key;
}

// The values a row carries, once it opens under this ask's purpose and repeats it exactly before the expiry; throws why not.
function openChecked(body: NonNullable<ReturnType<typeof secretUseBody>>, ask: Ask, open: (sealed: Sealed, purpose: string) => string, now: number): Record<string, string> {
  let text: string;
  try {
    text = open(body.sealed, secretUsePurpose(ask.cardId, body.nonce, ask.command));
  } catch {
    throw new Error("That secret use wasn't sealed to this worker for this card's command.");
  }
  const use = openedUse(text);
  if (!use || use.card !== ask.cardId || use.nonce !== body.nonce) throw new Error("That secret use is for another ask.");
  if (use.command !== ask.command) throw new Error("That secret use is for another command.");
  if (!sameNames(use.names, ask.names) || use.environment !== ask.environment) throw new Error("That secret use names other secrets.");
  if (!sameNames(Object.keys(use.values), ask.names)) throw new Error("That secret use doesn't carry the values it names.");
  if (now > use.expiresAt) throw new Error("That secret use came after its ask expired.");
  return use.values;
}

// The daemon's `secret_use`: hands the values to the waiting tool and returns its card, or throws why it won't.
export function deliverSecretUse(command: Pick<CloudCommandRow, "payload">, open: (sealed: Sealed, purpose: string) => string, macs: MacKeys, now = Date.now()): string {
  const body = secretUseBody(command);
  if (!body) throw new Error("That secret use is empty.");
  const mac = signingMac(body, macs);
  const ask = asks().get(body.nonce);
  if (!ask) throw new Error("That secret use answers no open ask: it was already used, it expired, or it was never asked for.");
  if (ask.cardId !== body.cardId) throw new Error("That secret use is for another card.");
  if (now > ask.expiresAt) {
    asks().delete(body.nonce);
    ask.reject(new Error("The approval came too late: the ask had expired. Ask again."));
    throw new Error("That secret use came after its ask expired.");
  }
  const values = openChecked(body, ask, open, now);
  asks().delete(body.nonce);
  if (!macs.pinned().length) macs.pin(mac);
  ask.resolve(values);
  return ask.cardId;
}
