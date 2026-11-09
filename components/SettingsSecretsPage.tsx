"use client";

// Settings → Secrets (docs/architecture/secrets.md, "The drawer and Settings → Secrets"): managing the 🔐 vaults, so
// the drawer can be for using them. One card per board project's vault (./VaultManage: sharing, Ask to join, the Macs
// asking, the recovery key, env files, the event log), then who used the Keychain and the vault (./KeychainAccess,
// moved here from Security). The import preview opens in place of the cards, as it does in the drawer.
import { useState } from "react";
import { secretsSettingsNote } from "@/lib/secrets-settings-view";
import { takeSecretsFocus } from "@/lib/secrets-settings";
import { useBoardVaults } from "@/lib/use-board-vaults";
import { useVaultActions } from "@/lib/use-vault-actions";
import KeychainAccess from "./KeychainAccess";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";
import { VaultImportFor } from "./VaultImportFor";
import { VaultManage } from "./VaultManage";

export default function SettingsSecretsPage() {
  const { bridge, overview, error, reload } = useBoardVaults();
  const [toast, setToast] = useState<string | null>(null);
  const notify = (err: unknown) => setToast(err instanceof Error ? err.message : String(err));
  const actions = useVaultActions(bridge, overview, reload, notify);
  const [focus] = useState(takeSecretsFocus);
  const note = secretsSettingsNote(Boolean(bridge), overview, error);
  return (
    <>
      <SettingsCard>
        <SettingsSectionHeader
          title="Vaults"
          hint="Each project's secrets: who they're shared with, the Macs that hold them, and the env files they come from. Use them from the 🔐 drawer."
        />
        {note ? <p className="mt-2 text-[12.5px] text-muted">{note}</p> : null}
        {toast ? (
          <p role="status" className="mt-2 text-[12.5px] text-muted">
            {toast}
          </p>
        ) : null}
      </SettingsCard>
      {actions.importing && overview ? (
        <SettingsCard>
          <VaultImportFor actions={actions} vaults={overview.vaults} locatable={Boolean(bridge?.locate)} />
        </SettingsCard>
      ) : (
        overview?.vaults.map((v) => (
          <VaultManage key={v.id} vault={v} bridge={bridge} orgs={overview.orgs ?? []} actions={actions} onChanged={() => void reload()} notify={notify} focused={focus === v.id} />
        ))
      )}
      <SettingsCard>
        <KeychainAccess />
      </SettingsCard>
    </>
  );
}
