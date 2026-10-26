// The Connectors page: outside services and local tools your threads can work in, each through a CLI Weft runs for them.
import { SETTINGS_HINT, SETTINGS_TITLE } from "@/lib/settings-shared";
import GogConnector from "./GogConnector";
import { SettingsCard } from "./SettingsLayout";
import SimulatorConnector from "./SimulatorConnector";

export default function SettingsConnectorsPage() {
  return (
    <>
      <SettingsCard>
        <GogConnector titleClass={SETTINGS_TITLE} hintClass={SETTINGS_HINT} />
      </SettingsCard>
      <SettingsCard>
        <SimulatorConnector titleClass={SETTINGS_TITLE} hintClass={SETTINGS_HINT} />
      </SettingsCard>
    </>
  );
}
