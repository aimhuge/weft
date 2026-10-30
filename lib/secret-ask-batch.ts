import type { SecretAsk, VaultEnvironment } from "./vault-view";

// A thread's open asks for keys (mcp__secrets__ask_add), filled in together (components/SecretAskBatch.tsx): every
// input stays open while the user pastes, one Add puts all the filled ones in the vault, and the thread hears one
// message once none is left open, so the turn it wakes doesn't cut in while the user is still pasting.
export type AskField = { ask: SecretAsk; value: string; environments: VaultEnvironment[] };

// One key the user added: its name and the environments it went to, never the value.
export type AddedKey = { name: string; environments: VaultEnvironment[] };

// A field that has something to add.
export function isFilled(field: AskField): boolean {
  return Boolean(field.value) && field.environments.length > 0;
}

// A thread can ask for the same key twice; once it's in the vault for the asked environment, the other ask is
// answered too.
export function answeredBy(field: AskField, added: { folder: string } & AddedKey): boolean {
  return field.ask.folder === added.folder && field.ask.name === added.name && added.environments.includes(field.ask.environment);
}

// What the thread is told: each key and its environments, never a value.
export function addedMessage(keys: AddedKey[]): string {
  return `I added ${keys.map((k) => `${k.name} (${k.environments.join(", ")})`).join(", ")} to the 🔐 vault.`;
}

// The Add button: the count when several keys go at once, else how many environments the one key goes to.
export function addLabel(filled: number, environments: number): string {
  if (filled > 1) return `Add ${filled} keys to vault`;
  return environments > 1 ? `Add to ${environments} environments` : "Add to vault";
}
