// The wire of a worker card's vault calls (docs/architecture/project-hosts.md#the-vault-and-connectors-on-a-worker-t2-as-built).
// A worker card's mcp__secrets__list, add_blank, ask_add, set_value and push_to_vercel, and its dev server's env, ask the
// owner's Mac with a device call (worker_mac_ask, one of VAULT_TOOLS). Each ask is signed by the worker's pairing key over
// vaultAskMessage, which names the card, the box key the Mac seals to, the tool and every field the Mac acts on, so a
// stolen `wwk_` key alone can ask nothing. electron/worker-vault-wire.cjs is main's copy, held to this by a test.
import { createHash } from "node:crypto";

export const VAULT_LIST = "vault_list";
export const VAULT_BLANK = "vault_blank";
export const VAULT_SET = "vault_set";
export const VAULT_PUSH = "vault_push";
export const DEV_ENV = "dev_env";
// Every one goes to Electron main by its call id only (lib/device-calls.ts → POST /secrets/worker-vault).
export const VAULT_TOOLS: ReadonlySet<string> = new Set([VAULT_LIST, VAULT_BLANK, VAULT_SET, VAULT_PUSH, DEV_ENV]);

// What a worker card asks the Mac for. Names, never a vault value; `sealed` is set_value's value, sealed to the Mac.
export interface VaultAsk {
  nonce: string;
  expiresAt: number;
  // The checkout's git origin, which names the vault.
  remote: string;
  environment?: string;
  names?: string[];
  name?: string;
  hint?: string;
  replace?: boolean;
  sealed?: string;
  command?: string;
  cwd?: string;
  script?: string;
  thread?: string;
  why?: string;
  // The worker's signature over vaultAskMessage, base64.
  sig?: string;
}

// What the worker signs. Every field main reads to act is in it, in a fixed order; thread and why are only shown.
export function vaultAskMessage(cardId: string, boxKey: string, tool: string, a: Omit<VaultAsk, "sig" | "thread" | "why">): string {
  return JSON.stringify(["weft-vault-ask-v1", cardId, boxKey, tool, a.nonce, a.expiresAt, a.remote, a.environment ?? null, a.names ?? null, a.name ?? null, a.hint ?? null, a.replace === true, a.sealed ?? null, a.command ?? null, a.cwd ?? null, a.script ?? null]);
}

// A dev server's values are sealed for this purpose (and travel as a `secret_use` with `use: "dev"`): a payload sealed
// for a run, another card, ask or command won't open as one.
export function devEnvPurpose(card: string, nonce: string, command: string): string {
  return `dev-env:${card}:${nonce}:${createHash("sha256").update(command, "utf8").digest("hex")}`;
}

// set_value's plaintext, sealed by the worker to the Mac's key (lib/mac-box.ts); main checks each field against the row.
export interface SetValuePlain {
  v: 1;
  card: string;
  nonce: string;
  name: string;
  environment: string;
  value: string;
}
