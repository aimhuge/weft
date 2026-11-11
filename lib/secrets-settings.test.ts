// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { OPEN_SETTINGS_EVENT, openSecretsSettings, takeSecretsFocus } from "./secrets-settings";
import { rememberedPage } from "./settings-nav";
import { secretsSettingsNote } from "./secrets-settings-view";

describe("openSecretsSettings", () => {
  it("remembers the Secrets page, keeps the vault to show once, and asks the board to open Settings", () => {
    const heard = vi.fn();
    window.addEventListener(OPEN_SETTINGS_EVENT, heard);
    openSecretsSettings("github:o/web");
    expect(rememberedPage()).toBe("secrets");
    expect(heard).toHaveBeenCalled();
    expect(takeSecretsFocus()).toBe("github:o/web");
    expect(takeSecretsFocus()).toBeNull();
    openSecretsSettings();
    expect(takeSecretsFocus()).toBeNull();
    window.removeEventListener(OPEN_SETTINGS_EVENT, heard);
  });
});

describe("secretsSettingsNote", () => {
  it("is null once there are vaults", () => {
    expect(secretsSettingsNote(true, { unlocked: false, vaults: [{ id: "a" } as never] }, null)).toBeNull();
  });
});
