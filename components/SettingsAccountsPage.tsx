// The Accounts page: the Weft account and the CLI sign-ins. How long saved sign-ins last is on Security.
import { SETTINGS_HINT, SETTINGS_TITLE } from "@/lib/settings-shared";
import AccountSettings from "./AccountSettings";
import CliLogins from "./CliLogins";
import { SettingsCard } from "./SettingsLayout";

export default function SettingsAccountsPage() {
  return (
    <>
      <SettingsCard>
        <AccountSettings titleClass={SETTINGS_TITLE} hintClass={SETTINGS_HINT} />
      </SettingsCard>
      <SettingsCard>
        <CliLogins titleClass={SETTINGS_TITLE} />
      </SettingsCard>
    </>
  );
}
