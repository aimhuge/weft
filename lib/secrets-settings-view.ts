import type { VaultOverview } from "./vault-view";

// What Settings → Secrets says instead of its vaults: off the desktop, loading, a failure, or no project yet.
export function secretsSettingsNote(desktop: boolean, overview: VaultOverview | null, error: string | null): string | null {
  if (!desktop) return "The vaults live in Weft's desktop app, where Electron keeps their keys in the Keychain.";
  if (error) return error;
  if (!overview) return "Opening the vaults…";
  if (!overview.vaults.length) return "Add a project to the board to keep its secrets in a vault.";
  return null;
}
