import { describe, expect, it } from "vitest";
import { computeDirty, initialSettingsForm, settingsDirtyPages, settingsPatch } from "./settings-form";
import type { SettingsView } from "./types";

const BASE: SettingsView = {
  threadPrompt: "be nice",
  defaultThreadPrompt: "be nice",
  keepAliveMinutes: 0,
  defaultPermissionMode: "auto",
  defaultBackend: "claude",
  automations: [{ id: "a1", skill: "lint", on: "start" }],
  pushOnDone: false,
  subagentModel: "choose",
  doneModel: "",
  doneEffort: "",
  copilotModel: "",
  reviewAllModel: "",
  backupModel: "",
  projects: [],
  issueFolders: [],
  syncFolders: [],
  allowedFolders: [],
  gooseProviderId: "",
  gooseModelId: "",
  gooseBaseUrl: "",
};

describe("initialSettingsForm", () => {
  it("copies the editable fields from the server view", () => {
    const form = initialSettingsForm(BASE);
    expect(form.prompt).toBe("be nice");
    expect(form.keepAlive).toBe(0);
    expect(form.mode).toBe("auto");
    expect(form.defaultBackend).toBe("claude");
    expect(form.rules).toEqual(BASE.automations);
  });
});

describe("computeDirty", () => {
  it("is not dirty when nothing changed", () => {
    const form = initialSettingsForm(BASE);
    const d = computeDirty(form, BASE);
    expect(d).toEqual({
      promptChanged: false,
      keepAliveChanged: false,
      modeChanged: false,
      defaultBackendChanged: false,
      rulesChanged: false,
      isDefaultPrompt: true,
    });
  });

  it("flags each field that changed", () => {
    const form = { ...initialSettingsForm(BASE), keepAlive: 60, mode: "default" as const, defaultBackend: "puku" as const };
    const d = computeDirty(form, BASE);
    expect(d.keepAliveChanged).toBe(true);
    expect(d.modeChanged).toBe(true);
    expect(d.defaultBackendChanged).toBe(true);
  });

  it("ignores whitespace around the prompt", () => {
    const form = { ...initialSettingsForm(BASE), prompt: `  ${BASE.threadPrompt}  ` };
    const d = computeDirty(form, BASE);
    expect(d.promptChanged).toBe(false);
  });

  it("treats a rule without a skill as not saved", () => {
    const form = { ...initialSettingsForm(BASE), rules: [...BASE.automations, { id: "a2", skill: "  ", on: "start" as const }] };
    const d = computeDirty(form, BASE);
    expect(d.rulesChanged).toBe(false);
  });
});

describe("settingsDirtyPages", () => {
  it("returns threads when prompt/keepAlive changed", () => {
    const form = { ...initialSettingsForm(BASE), keepAlive: 60 };
    const d = computeDirty(form, BASE);
    expect(settingsDirtyPages(d).has("threads")).toBe(true);
  });

  it("returns models when backend changed", () => {
    const form = { ...initialSettingsForm(BASE), defaultBackend: "puku" as const };
    const d = computeDirty(form, BASE);
    expect(settingsDirtyPages(d).has("models")).toBe(true);
  });

  it("returns automations when rules changed", () => {
    const form = { ...initialSettingsForm(BASE), rules: [{ id: "a1", skill: "test", on: "start" as const }, { id: "a2", skill: "test", on: "start" as const }] };
    const d = computeDirty(form, BASE);
    expect(settingsDirtyPages(d).has("automations")).toBe(true);
  });

  it("is empty when nothing is dirty", () => {
    const form = initialSettingsForm(BASE);
    const d = computeDirty(form, BASE);
    expect(settingsDirtyPages(d).size).toBe(0);
  });
});

describe("settingsPatch", () => {
  it("only sends fields that changed", () => {
    const form = { ...initialSettingsForm(BASE), keepAlive: 60 };
    const d = computeDirty(form, BASE);
    expect(settingsPatch(form, d)).toEqual({ keepAliveMinutes: 60 });
  });

  it("saves the default prompt as the empty string", () => {
    const form = { ...initialSettingsForm(BASE), prompt: "be nice" };
    const d = computeDirty(form, BASE);
    // Not dirty because it equals the default; no patch.
    expect(d.promptChanged).toBe(false);
    expect(settingsPatch(form, d).threadPrompt).toBeUndefined();
  });

  it("sends a custom prompt when the user changed it", () => {
    const form = { ...initialSettingsForm(BASE), prompt: "be nicer" };
    const d = computeDirty(form, BASE);
    expect(settingsPatch(form, d).threadPrompt).toBe("be nicer");
  });

  it("drops rules with empty skills", () => {
    const form = { ...initialSettingsForm(BASE), rules: [{ id: "a1", skill: "test", on: "start" as const }, { id: "a2", skill: "  ", on: "start" as const }] };
    const d = computeDirty(form, BASE);
    expect(settingsPatch(form, d).automations).toEqual([{ id: "a1", skill: "test", on: "start" }]);
  });
});
