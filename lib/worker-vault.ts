// A worker card's vault calls that carry names (docs/architecture/project-hosts.md#the-vault-on-a-worker-t2-as-built):
// mcp__secrets__list, add_blank, ask_add, set_value and push_to_vercel. The vault is on the owner's Mac, so each one is a
// device call to it (worker_mac_ask, lib/worker-mac-ask.ts), signed with this box's pairing key over vaultAskMessage. The
// Mac re-reads the row, checks the signature against the key it pinned and answers from the vault the card's own git
// remote names (electron/worker-vault.cjs). No vault value ever comes back; set_value's value goes up sealed to the Mac.
import { randomBytes } from "node:crypto";
import { asText } from "./format";
import { sealToMac } from "./mac-box";
import { ASK_MS, newNonce } from "./secret-use";
import { askMac } from "./worker-mac-ask";
import { gitRemote } from "./worker-secret-run";
import { VAULT_BLANK, VAULT_LIST, VAULT_PUSH, VAULT_SET, vaultAskMessage, type SetValuePlain, type VaultAsk } from "./worker-vault-wire";

export interface VaultLink {
  // Signs with the pairing's sign key (sign-key.json); absent on a token-enrolled box, which the Mac won't answer.
  sign?: (message: string) => string;
  // This box's seal key, which the signature names so the Mac seals only to it.
  boxKey: string;
  // The Mac this box was paired with (mac-keys.json): set_value's value is sealed to it.
  macKey: () => string | undefined;
}

export interface VaultDeps {
  link: VaultLink | null;
  ask: (cardId: string | undefined, tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  remote: (root: string) => Promise<string | null>;
  now: () => number;
  nonce: () => string;
  seal: (macKey: string, plaintext: string) => Promise<string>;
}

let current: VaultLink | null = null;

// scripts/weft-worker.ts, through lib/worker-secret-wiring.ts.
export function setVaultLink(next: VaultLink | null) {
  current = next;
}

export const UNPAIRED = "This worker was enrolled by token, so your Mac won't answer its vault asks. Pair it from Settings → Devices → Add a worker.";
const NO_MAC = "This worker trusts no Mac to seal a value to. Pair it from Settings → Devices → Add a worker.";

const resolve = (given: Partial<VaultDeps>): VaultDeps => ({ link: current, ask: askMac, remote: gitRemote, now: Date.now, nonce: () => newNonce(randomBytes), seal: sealToMac, ...given });

type Fields = Omit<VaultAsk, "nonce" | "expiresAt" | "remote" | "sig">;

// One signed ask and the Mac's answer, or a throw that says why there's none.
export async function askVault(cardId: string | undefined, root: string, tool: string, fields: Fields, given: Partial<VaultDeps> = {}, nonce?: string): Promise<Record<string, unknown>> {
  const deps = resolve(given);
  if (!cardId) throw new Error("Only a card's thread can reach the vault on your Mac.");
  const link = deps.link;
  if (!link) throw new Error("This worker can't reach your Mac's vault yet. Update it (weft-worker update).");
  if (!link.sign) throw new Error(UNPAIRED);
  const remote = await deps.remote(root);
  if (!remote) throw new Error("This project has no git remote on the worker, so no vault on your Mac matches it.");
  const ask = { ...fields, nonce: nonce ?? deps.nonce(), expiresAt: deps.now() + ASK_MS, remote };
  return deps.ask(cardId, tool, { ...ask, sig: link.sign(vaultAskMessage(cardId, link.boxKey, tool, ask)) });
}

export interface Listed {
  name: string;
  environment: string;
  missing: boolean;
}

const listedOf = (raw: unknown): Listed[] =>
  (Array.isArray(raw) ? raw : []).flatMap((s: unknown) => {
    const e = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return typeof e.name === "string" && typeof e.environment === "string" ? [{ name: e.name, environment: e.environment, missing: e.missing === true }] : [];
  });

/** mcp__secrets__list on a worker: the names in the vault the card's remote names, as the Mac has them. */
export async function listOnWorker(cardId: string | undefined, root: string, given: Partial<VaultDeps> = {}) {
  const r = await askVault(cardId, root, VAULT_LIST, {}, given);
  return { label: asText(r.label), secrets: listedOf(r.secrets) };
}

/** add_blank and ask_add on a worker: names in as blanks on the Mac; which already had a value comes back. */
export async function blankOnWorker(cardId: string | undefined, root: string, names: string[], environment: string, hint?: string, given: Partial<VaultDeps> = {}) {
  const r = await askVault(cardId, root, VAULT_BLANK, { names, environment, ...(hint ? { hint } : {}) }, given);
  return { label: asText(r.label), filled: Array.isArray(r.filled) ? r.filled.filter((n): n is string => typeof n === "string") : [] };
}

/** set_value on a worker: the value sealed to the paired Mac, stored there after the user's Touch ID. */
export async function setOnWorker(cardId: string | undefined, root: string, put: { name: string; value: string; environment: string; replace?: boolean }, given: Partial<VaultDeps> = {}) {
  const deps = resolve(given);
  const macKey = deps.link?.macKey();
  if (!macKey) throw new Error(deps.link?.sign ? NO_MAC : UNPAIRED);
  const nonce = deps.nonce();
  const plain: SetValuePlain = { v: 1, card: cardId ?? "", nonce, name: put.name, environment: put.environment, value: put.value };
  const sealed = await deps.seal(macKey, JSON.stringify(plain));
  return askVault(cardId, root, VAULT_SET, { name: put.name, environment: put.environment, replace: put.replace === true, sealed }, deps, nonce);
}

/** push_to_vercel on a worker: the Mac pushes from its vault to the Vercel project its own clone links, after Touch ID. */
export const pushOnWorker = (cardId: string | undefined, root: string, name: string, environment: string, given: Partial<VaultDeps> = {}) => askVault(cardId, root, VAULT_PUSH, { name, environment }, given);
