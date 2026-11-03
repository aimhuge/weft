// A Goose turn's provider key on a Weft Worker (docs/architecture/weft-worker.md#goose-on-a-worker). The key lives in the
// paired Mac's Keychain (electron/goose-token.cjs) and a worker has no Electron main to grant it, so a turn whose
// provider takes a key asks the Mac with a `goose_key` device call (worker_mac_ask), signed by this box's pairing key over
// the card, its box key, a fresh nonce, the expiry, the provider and the endpoint (lib/worker-goose-key-wire.ts). Main
// answers only for the provider and endpoint it last set on this worker, after Touch ID, with a Mac-signed `secret_use`
// sealed to this box for that ask (electron/worker-goose-key.cjs); lib/worker-secret-asks.ts opens it.
//
// The key then goes into that one Goose process's env, through gooseEnvFor (lib/goose-provider.ts), never this daemon's
// env, an argument or a file. It's kept in memory for redactStored until the card's turn ends (lib/worker-secret-run.ts
// remember, forgetOnTurnEnd), and every turn asks again.
import { randomBytes } from "node:crypto";
import { gooseEnvFor, providerById } from "./goose-provider";
import { markInUse } from "./secret-run";
import { ASK_MS, newNonce } from "./secret-use";
import { within } from "./worker-dev-env";
import { GOOSE_KEY, GOOSE_KEY_ENVIRONMENT, gooseKeyAskMessage, gooseKeyCommand, gooseKeyName } from "./worker-goose-key-wire";
import { askMac } from "./worker-mac-ask";
import { openAsk } from "./worker-secret-asks";
import { remember } from "./worker-secret-run";
import { UNPAIRED, vaultLink, type VaultLink } from "./worker-vault";

export interface GooseKeyRequest {
  cardId?: string | null;
  providerId: string;
  baseUrl: string;
}

export interface GooseKeyDeps {
  link: VaultLink | null;
  ask: (cardId: string | undefined, tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  now: () => number;
  nonce: () => string;
  waitMs: number;
}

// Providers that may sit behind an endpoint that takes no key: without one from the Mac, Goose still starts.
const MAY_BE_KEYLESS = new Set(["custom", "litellm"]);

async function askForKey(req: GooseKeyRequest & { cardId: string }, name: string, label: string, deps: GooseKeyDeps): Promise<Record<string, string>> {
  const link = deps.link;
  if (!link?.sign) throw new Error(`Goose needs your ${label} key, and only your Mac has it. ${UNPAIRED}`);
  const signed = { nonce: deps.nonce(), expiresAt: deps.now() + ASK_MS, providerId: req.providerId, baseUrl: req.baseUrl };
  const ask = openAsk(signed.nonce, { cardId: req.cardId, command: gooseKeyCommand(req.providerId, req.baseUrl), names: [name], environment: GOOSE_KEY_ENVIRONMENT, expiresAt: signed.expiresAt, goose: true });
  try {
    const answer = await deps.ask(req.cardId, GOOSE_KEY, { ...signed, sig: link.sign(gooseKeyAskMessage(req.cardId, link.boxKey, signed)) });
    if (answer.none === true) throw new Error(`There's no ${label} key saved on your Mac. Add one in Weft's Goose providers there, then send the message again.`);
    if (answer.denied === true) throw new Error(`Goose needs your ${label} key from your Mac, and it wasn't approved there.`);
    if (answer.queued !== true) throw new Error(`Your Mac didn't send your ${label} key.`);
    const values = await within(ask.values, deps.waitMs, `Your Mac approved your ${label} key, but it didn't arrive.`);
    // lib/worker-secret-asks.ts delivers only a row naming exactly this ask's one name.
    const key = String(values[name]);
    markInUse(req.cardId);
    remember(req.cardId, { [name]: key });
    return gooseEnvFor(req.providerId, key, { baseUrl: req.baseUrl });
  } finally {
    ask.drop();
  }
}

/**
 * The env for one Goose process with the Mac's key in it, or undefined when the provider takes none (or may run keyless
 * and none came). Throws why there's no key for a provider that can't run without one.
 */
export async function gooseKeyOnWorker(req: GooseKeyRequest, given: Partial<GooseKeyDeps> = {}): Promise<Record<string, string> | undefined> {
  const provider = providerById(req.providerId);
  const name = gooseKeyName(req.providerId);
  const cardId = req.cardId;
  if (!provider || !name || !cardId) return undefined;
  const deps: GooseKeyDeps = { link: vaultLink(), ask: askMac, now: Date.now, nonce: () => newNonce(randomBytes), waitMs: ASK_MS, ...given };
  try {
    return await askForKey({ ...req, cardId }, name, provider.label, deps);
  } catch (err) {
    if (!MAY_BE_KEYLESS.has(req.providerId)) throw err;
    console.error(`Goose starts without a key: ${(err as Error).message}`);
    return undefined;
  }
}
