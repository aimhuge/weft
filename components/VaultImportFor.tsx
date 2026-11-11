"use client";

import type { VaultActions } from "@/lib/use-vault-actions";
import type { VaultSummary } from "@/lib/vault-view";
import { ImportPreview } from "./VaultParts";

// The import's preview, open while actions.importing holds the scan, with Locate… for the vault it was opened on
// when the shell can open main's dialog.
export function VaultImportFor({ actions, vaults, locatable }: { actions: VaultActions; vaults: VaultSummary[]; locatable: boolean }) {
  const importing = actions.importing;
  if (!importing) return null;
  const into = locatable ? vaults.find((v) => v.folders.includes(importing.folder)) : undefined;
  return (
    <ImportPreview
      scan={importing.scan}
      picked={importing.picked}
      busy={actions.busy}
      onToggle={actions.toggleImport}
      onImport={() => void actions.finishImport()}
      onClose={() => actions.setImporting(null)}
      manage={importing.manage}
      onManage={(on) => actions.setImporting({ ...importing, manage: on })}
      onLocate={into ? () => void actions.locate(into) : undefined}
    />
  );
}
