// The Security page: what threads may do without asking (the default permission mode, the folders outside a
// project they may use) and how long the saved sign-ins last.
import ModePicker from "./ModePicker";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";
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
        <TokenExpiry />
      </SettingsCard>
    </>
  );
}
