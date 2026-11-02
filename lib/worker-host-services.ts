// What a Weft Worker runs beside its inbox so its cards behave as yours do on the Mac
// (docs/architecture/project-hosts.md#settings-on-a-worker-wp3): your account's settings mirrored in
// (lib/worker-settings-sync.ts), and its plan limits polled and published (lib/worker-limits.ts). scripts/weft-worker.ts
// starts it once the engine has loaded; `nudge` is called as commands arrive, `stop` on the way out.
import { applyAccountSettings } from "./host-settings";
import { readSamples } from "./limit-history";
import { startLimitPoll } from "./limit-poll";
import { startWorkerLimits } from "./worker-limits";
import type { Registry } from "./worker-registry";
import { createSettingsSync } from "./worker-settings-sync";

export function startHostServices(reg: Pick<Registry, "accountSettings" | "setLimits">, log: (msg: string) => void) {
  const settings = createSettingsSync({ read: () => reg.accountSettings(), apply: applyAccountSettings, log });
  const stopSettings = settings.start();
  const limits = startWorkerLimits({ poll: startLimitPoll, read: () => readSamples(), setLimits: (packed) => reg.setLimits(packed), log });
  return {
    nudge: settings.nudge,
    stop() {
      stopSettings();
      limits.stop();
    },
  };
}
