import { filterByQuery, matchesQuery, queryWords } from "./text-filter";
import type { VaultSecret, VaultSummary } from "./vault-view";

// The 🔐 drawer's search box: a secret matches when its name, or a blank's hint, holds every word of the
// query in any case ("stripe hook" finds STRIPE_WEBHOOK_SECRET). A blank query matches everything.
// The rule is lib/text-filter.ts's, with "_" as a word break too.

const SPLIT = /[\s_]+/;
const fieldsOf = (s: Pick<VaultSecret, "name" | "hint">) => [s.name, s.hint];

export function matchesSecret(s: Pick<VaultSecret, "name" | "hint">, query: string): boolean {
  return matchesQuery(fieldsOf(s), query, SPLIT);
}

export function searchSecrets<T extends Pick<VaultSecret, "name" | "hint">>(secrets: T[], query: string): T[] {
  return filterByQuery(secrets, query, fieldsOf, SPLIT);
}

// The vaults worth a section while searching: those with a match, plus the one whose form is open.
export function vaultsWithMatches(vaults: VaultSummary[], query: string, editingVault: string | null): VaultSummary[] {
  if (!queryWords(query, SPLIT).length) return vaults;
  return vaults.filter((v) => v.id === editingVault || searchSecrets(v.secrets, query).length > 0);
}
