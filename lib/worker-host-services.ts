// What a Weft Worker runs beside its inbox so its cards behave as yours do on the Mac
// (docs/architecture/project-hosts.md#settings-on-a-worker-wp3): your account's settings mirrored in once your paired
// Mac's signature checks (lib/worker-settings-sync.ts, lib/account-settings-sig.ts), and its plan limits polled and
// published with the models at their cap (lib/worker-limits.ts). scripts/weft-worker.ts starts it once the engine has loaded; `nudge` is called as
// commands arrive, `stop` on the way out.
import fs from "node:fs";
import path from "node:path";
import { settingsRefusal } from "./account-settings-sig";
import { applyAccountSettings } from "./host-settings";
import { readSamples } from "./limit-history";
import { startLimitPoll } from "./limit-poll";
import { modelLimits } from "./model-limit";
import { macKeysAt } from "./worker-mac-keys";
import { startWorkerLimits } from "./worker-limits";
import type { Registry } from "./worker-registry";
import { createSettingsSync } from "./worker-settings-sync";

// The version of the settings last applied, beside mac-keys.json in the worker's home (sealed from threads, as the
// rest of the home is: lib/secret-guard-files.ts), so a restart doesn't take an older signed row put back.
export function settingsVersionAt(home: string) {
  const file = path.join(home, "account-settings-version");
  return {
    read(): number {
      try {
        const n = Number(fs.readFileSync(file, "utf8").trim());
        return Number.isSafeInteger(n) ? n : 0;
      } catch {
        return 0;
      }
    },
    write(version: number) {
      fs.mkdirSync(home, { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, `${version}\n`, { mode: 0o600 });
    },
  };
}

export function startHostServices(reg: Pick<Registry, "accountSettings" | "setLimits">, log: (msg: string) => void, home: string) {
  const macs = macKeysAt(home);
  const version = settingsVersionAt(home);
  const settings = createSettingsSync({
    read: () => reg.accountSettings(),
    refuse: (row) => settingsRefusal(row, macs.pinned(), version.read()),
    apply: applyAccountSettings,
    accepted: (row) => version.write(row.version as number),
    log,
  });
  const stopSettings = settings.start();
  const limits = startWorkerLimits({ poll: startLimitPoll, read: () => readSamples(), models: () => modelLimits(), setLimits: (packed) => reg.setLimits(packed), log });
  return {
    nudge: settings.nudge,
    stop() {
      stopSettings();
      limits.stop();
    },
  };
}
