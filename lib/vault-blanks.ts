// The 🔐 drawer's "To fill in" list (docs/architecture/secrets.md, "What the drawer shows"): every blank in a vault,
// across environments, in one group above the values, so a vault with twenty blanks still opens on its secrets.
import { ENVIRONMENTS, type VaultEnvironment, type VaultSecret } from "./vault-view";

// A blank, and the environments where the same name already has a value ("set in production").
export type BlankRow = { secret: VaultSecret; elsewhere: VaultEnvironment[] };

const order = (env: VaultEnvironment) => ENVIRONMENTS.findIndex((e) => e.id === env);

// The blanks by name, then environment.
export function blanksOf(secrets: VaultSecret[]): BlankRow[] {
  return secrets
    .filter((s) => s.missing)
    .sort((a, b) => a.name.localeCompare(b.name) || order(a.environment) - order(b.environment))
    .map((secret) => ({
      secret,
      elsewhere: ENVIRONMENTS.map((e) => e.id).filter((env) => secrets.some((s) => s.name === secret.name && s.environment === env && !s.missing)),
    }));
}

// The few words beside a blank's name: where it already has a value, else its environment when that isn't the
// usual development. Null for a plain development blank.
export function blankNote({ secret, elsewhere }: BlankRow): string | null {
  const label = (env: VaultEnvironment) => ENVIRONMENTS.find((e) => e.id === env)?.label.toLowerCase() ?? env;
  if (elsewhere.length) return `set in ${elsewhere.map(label).join(", ")}`;
  return secret.environment === "development" ? null : label(secret.environment);
}

// Open on its own when there's little else to see: a search, a vault of blanks only, or just a few.
export const BLANKS_SHOWN_OPEN = 3;
export function blanksOpenByDefault(blanks: number, values: number, query: string): boolean {
  return Boolean(query.trim()) || values === 0 || blanks <= BLANKS_SHOWN_OPEN;
}
