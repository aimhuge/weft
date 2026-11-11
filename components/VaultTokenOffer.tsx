// One line under a provider's token form: "Use VERCEL_TOKEN from aimhuge/weft" when a project vault holds
// what the provider wants (electron/provider-vault-token.cjs). Clicking asks Touch ID in main, which reads
// the value and hands it to the provider; only names pass through here. Nothing shows when there's none,
// or in a shell without the bridge methods.
"use client";
import { useEffect, useState } from "react";

import { vaultTokenLabel, type VaultTokenCandidate, type VaultTokenPick } from "@/lib/provider-vault-token";

import { SMALL } from "./tone";

export interface VaultTokenSource {
  vaultTokenCandidates?: (folders: string[]) => Promise<VaultTokenCandidate[]>;
}

export function VaultTokenOffer({
  source,
  folders,
  busy,
  onUse,
}: {
  source: VaultTokenSource | null;
  folders: string[];
  busy: boolean;
  onUse: (pick: VaultTokenPick) => Promise<void>;
}) {
  const [found, setFound] = useState<VaultTokenCandidate | null>(null);
  const key = folders.join("\n");
  useEffect(() => {
    let live = true;
    void source?.vaultTokenCandidates?.(key ? key.split("\n") : []).then(
      (list) => live && setFound(list[0] ?? null),
      () => live && setFound(null),
    );
    return () => {
      live = false;
    };
  }, [source, key]);
  if (!found) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void onUse(found)}
      title="Asks Touch ID; the value never leaves Weft's main process"
      className={`${SMALL} mx-3 mb-3 self-start text-left`}
    >
      {vaultTokenLabel(found)} 🔐
    </button>
  );
}
