import { describe, expect, it } from "vitest";
import { computeDirty, emptyPending, initialSettingsForm, settingsDirtyPages, settingsPatch } from "./settings-form";
import type { SettingsView } from "./types";

const BASE: SettingsView = {
  threadPrompt: "be nice",
  defaultThreadPrompt: "be nice",
  keepAliveMinutes: 0,
  maxThreads: 6,
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
  issueLandings: {},
  syncFolders: [],
  allowedFolders: [],
  gooseProviderId: "",
  gooseModelId: "",
  gooseBaseUrl: "",
  gooseNamedModels: [],
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
      maxThreadsChanged: false,
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

  it("sends the thread cap when it changed", () => {
    const form = { ...initialSettingsForm(BASE), maxThreads: 12 };
    const d = computeDirty(form, BASE);
    expect(d.maxThreadsChanged).toBe(true);
    expect(settingsPatch(form, d).maxThreads).toBe(12);
  });

  it("sends the permission mode when it changed", () => {
    const form = { ...initialSettingsForm(BASE), mode: "bypassPermissions" as const };
    const d = computeDirty(form, BASE);
    expect(d.modeChanged).toBe(true);
    expect(settingsPatch(form, d).defaultPermissionMode).toBe("bypassPermissions");
  });

  it("sends the default CLI when it changed", () => {
    const form = { ...initialSettingsForm(BASE), defaultBackend: "goose" as const };
    const d = computeDirty(form, BASE);
    expect(d.defaultBackendChanged).toBe(true);
    expect(settingsPatch(form, d).defaultBackend).toBe("goose");
  });

  it("sends every changed field at once", () => {
    const form = {
      ...initialSettingsForm(BASE),
      prompt: "be terse",
      keepAlive: 30,
      maxThreads: 4,
      mode: "acceptEdits" as const,
      defaultBackend: "puku" as const,
      rules: [{ id: "a9", skill: "lint", on: "done" as const }],
    };
    const d = computeDirty(form, BASE);
    expect(settingsPatch(form, d)).toEqual({
      threadPrompt: "be terse",
      keepAliveMinutes: 30,
      maxThreads: 4,
      defaultPermissionMode: "acceptEdits",
      defaultBackend: "puku",
      automations: [{ id: "a9", skill: "lint", on: "done" }],
    });
  });

  // A prompt typed back to the default is saved as the empty string, so a later change to the
  // default prompt still applies to the thread.
  it("saves the default prompt as the empty string when the user typed it back", () => {
    const base = { ...BASE, threadPrompt: "be nice" };
    const form = { ...initialSettingsForm(base), prompt: base.defaultThreadPrompt };
    const d = computeDirty(form, base);
    expect(d.promptChanged).toBe(false);
    expect(d.isDefaultPrompt).toBe(true);
  });

  it("saves an empty prompt as the empty string when the default changed under it", () => {
    const base = { ...BASE, threadPrompt: "old", defaultThreadPrompt: "new" };
    const form = { ...initialSettingsForm(base), prompt: "new" };
    const d = computeDirty(form, base);
    expect(d.promptChanged).toBe(true);
    expect(d.isDefaultPrompt).toBe(true);
    expect(settingsPatch(form, d).threadPrompt).toBe("");
  });
});

describe("emptyPending", () => {
  it("marks no page as unsaved", () => {
    expect(emptyPending).toEqual({
      prompt: false,
      keepAlive: false,
      maxThreads: false,
      mode: false,
      backend: false,
      rules: false,
    });
  });
});
