// The Settings dialog's editable form state, separated from the page rendering so each page stays
// focused on its own UI. The patch and the dirty-pages set are derived; the caller writes on Save
// and closes the dialog.
import { api } from "./client";
import { unsavedPages, type PendingEdits } from "./settings-nav";
import type { Automation, Backend, PermissionMode, SettingsView } from "./types";

export interface SettingsForm {
  prompt: string;
  keepAlive: number;
  maxThreads: number;
  mode: PermissionMode;
  defaultBackend: Backend;
  rules: Automation[];
}

export function initialSettingsForm(s: SettingsView): SettingsForm {
  return {
    prompt: s.threadPrompt,
    keepAlive: s.keepAliveMinutes,
    maxThreads: s.maxThreads,
    mode: s.defaultPermissionMode,
    defaultBackend: s.defaultBackend,
    rules: s.automations,
  };
}

export interface SettingsDirty {
  promptChanged: boolean;
  keepAliveChanged: boolean;
  maxThreadsChanged: boolean;
  modeChanged: boolean;
  defaultBackendChanged: boolean;
  rulesChanged: boolean;
  isDefaultPrompt: boolean;
}

export function computeDirty(form: SettingsForm, s: SettingsView): SettingsDirty {
  const isDefaultPrompt = form.prompt.trim() === s.defaultThreadPrompt.trim();
  // A rule left without a skill is dropped rather than refused.
  const rulesToSave = form.rules.filter((r) => r.skill.trim());
  return {
    promptChanged: form.prompt.trim() !== s.threadPrompt.trim(),
    keepAliveChanged: form.keepAlive !== s.keepAliveMinutes,
    maxThreadsChanged: form.maxThreads !== s.maxThreads,
    modeChanged: form.mode !== s.defaultPermissionMode,
    defaultBackendChanged: form.defaultBackend !== s.defaultBackend,
    rulesChanged: JSON.stringify(rulesToSave) !== JSON.stringify(s.automations),
    isDefaultPrompt,
  };
}

// The pages a settings change marks, so the nav can show the unsaved dot.
export function settingsDirtyPages(d: SettingsDirty) {
  return unsavedPages({
    prompt: d.promptChanged,
    keepAlive: d.keepAliveChanged,
    maxThreads: d.maxThreadsChanged,
    mode: d.modeChanged,
    backend: d.defaultBackendChanged,
    rules: d.rulesChanged,
  });
}

// What to send to the server: only the fields that changed, and the default thread prompt as the
// empty string so a later change to the default still applies.
export function settingsPatch(form: SettingsForm, d: SettingsDirty): Parameters<typeof api.saveSettings>[0] {
  const patch: Parameters<typeof api.saveSettings>[0] = {};
  if (d.promptChanged) patch.threadPrompt = d.isDefaultPrompt ? "" : form.prompt;
  if (d.keepAliveChanged) patch.keepAliveMinutes = form.keepAlive;
  if (d.maxThreadsChanged) patch.maxThreads = form.maxThreads;
  if (d.modeChanged) patch.defaultPermissionMode = form.mode;
  if (d.defaultBackendChanged) patch.defaultBackend = form.defaultBackend;
  if (d.rulesChanged) patch.automations = form.rules.filter((r) => r.skill.trim());
  return patch;
}

export const emptyPending: PendingEdits = {
  prompt: false,
  keepAlive: false,
  maxThreads: false,
  mode: false,
  backend: false,
  rules: false,
};
