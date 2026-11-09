// Types for "Use VERCEL_TOKEN from aimhuge/weft" (electron/provider-vault-token.cjs): a provider drawer with no
// token offers one a project vault already holds. The board sees names and the vault's label, never a value.

// A vault entry that could be the provider's token. `folder` is any folder of the vault's project, which
// is how main finds the vault again.
export interface VaultTokenCandidate {
  folder: string;
  label: string;
  name: string;
  environment: "development" | "production";
}

export type VaultTokenPick = Pick<VaultTokenCandidate, "folder" | "name" | "environment">;

// The provider's own status when it kept the token, or why nothing changed (Touch ID said no, the value went).
export type VaultTokenResult<S> = { status: S } | { denied: true } | { missing: true };

// The button's text: "Use VERCEL_TOKEN from aimhuge/weft".
export const vaultTokenLabel = (c: Pick<VaultTokenCandidate, "name" | "label">) => `Use ${c.name} from ${c.label}`;
