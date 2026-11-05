// The Security page: what threads may do without asking (the default permission mode, the folders outside a
// project they may use), how long the saved sign-ins last, who used the Keychain and the vault (KeychainAccess), and
// the site-notes sharing switch (lib/site-notes-store.ts) and the anonymous setup stats switch (lib/telemetry.ts).
import DeleteConfirmSwitch from "./DeleteConfirmSwitch";
import KeychainAccess from "./KeychainAccess";
import ModePicker from "./ModePicker";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";
import { SiteNotesSwitch } from "./SiteNotesSwitch";
import { StatsSwitch } from "./StatsSwitch";
import TokenExpiry from "./TokenExpiry";
import TrustedFolders from "./TrustedFolders";

type Mode = "default" | "acceptEdits" | "auto" | "bypassPermissions";

export default function SettingsSecurityPage({
  mode,
  setMode,
  allowedFolders,
  clearSaveError,
}: {
  mode: Mode;
  setMode: (next: Mode) => void;
  allowedFolders: string[];
  clearSaveError: () => void;
}) {
  return (
    <>
      <SettingsCard>
        <section className="flex items-center justify-between gap-4">
          <SettingsSectionHeader
            title="Default permission mode"
            hint="What a new thread starts in. You can still change it per thread."
          />
          <ModePicker
            end
            value={mode}
            onChange={(next) => {
              setMode(next);
              clearSaveError();
            }}
          />
        </section>
      </SettingsCard>
      <SettingsCard>
        <TrustedFolders folders={allowedFolders} />
      </SettingsCard>
      <SettingsCard>
        <DeleteConfirmSwitch />
      </SettingsCard>
      <SettingsCard>
        <TokenExpiry />
      </SettingsCard>
      <SettingsCard>
        <KeychainAccess />
      </SettingsCard>
      <SettingsCard>
        <SettingsSectionHeader title="Site notes" hint="What your cards learn about dashboards in the pane, so the next card goes straight there. Kept on this Mac and shared with your team." />
        <SiteNotesSwitch />
      </SettingsCard>
      <SettingsCard>
        <SettingsSectionHeader title="Setup stats" hint="Which welcome steps people finish, so the welcome gets better. Nothing from your board." />
        <StatsSwitch className="mt-2" />
      </SettingsCard>
    </>
  );
}
