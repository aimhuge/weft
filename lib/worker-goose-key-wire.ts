// The wire of a worker card's Goose key (docs/architecture/weft-worker.md#goose-on-a-worker). A Goose turn on a Weft
// Worker whose provider needs a key asks the paired Mac with a `goose_key` device call (worker_mac_ask), signed by the
// worker's pairing key over gooseKeyAskMessage: the card, the box key the Mac seals to, the ask's nonce and expiry, the
// provider and the endpoint. The Mac answers with a `secret_use` marked `use: "goose"`, sealed for gooseKeyPurpose, whose
// plaintext is an OpenedUse (lib/secret-use.ts) for gooseKeyCommand. electron/worker-goose-key-wire.cjs is main's copy,
// held to this by a test.
import { createHash } from "node:crypto";
import { providerById } from "./goose-provider";

export const GOOSE_KEY = "goose_key";
// The opened plaintext's environment: the Mac's Keychain key is never a project's development value, and like a
// production value it is never kept on a worker.
export const GOOSE_KEY_ENVIRONMENT = "production";

export interface GooseKeyAsk {
  nonce: string;
  expiresAt: number;
  providerId: string;
  baseUrl: string;
  // The card's title, shown only.
  thread?: string;
  // The worker's signature over gooseKeyAskMessage, base64.
  sig?: string;
}

// What the worker signs: every field main acts on, in a fixed order; the thread's title is only shown.
export function gooseKeyAskMessage(cardId: string, boxKey: string, a: Pick<GooseKeyAsk, "nonce" | "expiresAt" | "providerId" | "baseUrl">): string {
  return JSON.stringify(["weft-goose-key-ask-v1", cardId, boxKey, a.nonce, a.expiresAt, a.providerId, a.baseUrl]);
}

// The "command" a Goose key's OpenedUse names: the provider and the endpoint it's for, so a key sealed for one endpoint
// won't open as another's.
export function gooseKeyCommand(providerId: string, baseUrl: string): string {
  return JSON.stringify(["goose", providerId, baseUrl]);
}

// The seal's purpose: a payload sealed for a run, a dev server, another card, ask, provider or endpoint won't open as this.
export function gooseKeyPurpose(card: string, nonce: string, command: string): string {
  return `goose-key:${card}:${nonce}:${createHash("sha256").update(command, "utf8").digest("hex")}`;
}

/** The variable a provider's key goes in when it takes one, or null (unknown, or Ollama, whose variable is its host). */
export function gooseKeyName(providerId: string): string | null {
  const provider = providerById(providerId);
  return provider && provider.id !== "ollama" ? provider.envKey : null;
}
