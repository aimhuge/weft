// The 🔐 drawer's row action and the secret being added or changed. The drawer's pieces are
// components/SecretRow.tsx and components/VaultParts.tsx; these types live here so the drawer's
// action logic (lib/use-vault-actions.ts) can name them without reaching into a component. The
// components re-export them.

import type { VaultEnvironment } from "@/lib/vault-view";

// choose-remove asks which environments to remove it from (components/RemoveSecretDialog.tsx).
export type RowAction = "reveal" | "copy" | "edit" | "remove" | "choose-remove";

// A secret being added to one or more environments (fixed false), or given a new value (fixed true: the
// name stays, from is the environment it was opened in; ticking others saves it there too, unticking from
// moves it out; blank says it has no value yet, so it can move without one).
export interface Editing {
  vault: string;
  folder: string;
  name: string;
  environments: VaultEnvironment[];
  value: string;
  fixed: boolean;
  from?: VaultEnvironment;
  blank?: boolean;
}
