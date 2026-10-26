"use client";

import { useEffect, useState, type ReactNode } from "react";
import { showBacklog, showProgress } from "@/lib/board-prefs";
import { api } from "@/lib/client";
import { pageInfo, rememberPage, rememberedPage, SETTINGS_PAGES, type SettingsPage } from "@/lib/settings-nav";
import { computeDirty, initialSettingsForm, settingsDirtyPages, settingsPatch, type SettingsForm } from "@/lib/settings-form";
import { useSettingsBackdrop } from "@/lib/use-scene";
import type { SettingsView } from "@/lib/types";
import { SettingsCard, SettingsUnsavedDot } from "./SettingsLayout";
import Icon, { Spinner } from "./Icon";
import Modal from "./Modal";
import SettingsAccountsPage from "./SettingsAccountsPage";
import SettingsAutomationsPage from "./SettingsAutomationsPage";
import SettingsConnectorsPage from "./SettingsConnectorsPage";
import SettingsGeneralPage from "./SettingsGeneralPage";
import LaptopModeCard from "./LaptopModeCard";
import SettingsModelsPage from "./SettingsModelsPage";
import SettingsSecurityPage from "./SettingsSecurityPage";
import SettingsShortcutsPage from "./SettingsShortcutsPage";
import SettingsThreadsPage from "./SettingsThreadsPage";
import SyncSettings from "./SyncSettings";
import TeamSettings from "./TeamSettings";

const NEEDS_SETTINGS = new Set<SettingsPage>(["models", "threads", "security", "automations"]);

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// Settings fills the window over one of Weft's scenes: pages down the left, the open page's cards on the right.
// Appearance, board, sound, shortcut, account and most model changes apply right away; the rest wait for Save.
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [backlog, setBacklog] = useState(showBacklog);
  const [progress, setProgress] = useState(showProgress);
  const [page, setPageState] = useState<SettingsPage>(rememberedPage);
  const backdrop = useSettingsBackdrop();

  function setPage(next: SettingsPage) {
    rememberPage(next);
    setPageState(next);
  }

  useEffect(() => {
    let ignore = false;
    api.settings().then(
      (s) => {
        if (ignore) return;
        setSettings(s);
        setForm(initialSettingsForm(s));
      },
      (err: unknown) => {
        if (!ignore) setLoadError(message(err));
      },
    );
    return () => {
      ignore = true;
    };
  }, []);

  const clearSaveError = () => setSaveError(null);

  function updateForm<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  const dirty = settings && form ? computeDirty(form, settings) : null;
  const dirtyPages = dirty ? settingsDirtyPages(dirty) : new Set<SettingsPage>();

  async function save() {
    if (!settings || !form || !dirty) return;
    const patch = settingsPatch(form, dirty);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveSettings(patch);
      onClose();
    } catch (err) {
      setSaveError(message(err));
      setSaving(false);
    }
  }

  // What each page draws: a few cards. Pages in NEEDS_SETTINGS only draw once the server's settings are in.
  function pageBody(s: SettingsView): ReactNode {
    switch (page) {
      case "general":
        return (
          <SettingsGeneralPage
            backlog={backlog}
            setBacklog={setBacklog}
            progress={progress}
            setProgress={setProgress}
          />
        );
      case "laptop":
        return (
          <SettingsCard>
            <LaptopModeCard />
          </SettingsCard>
        );
      case "models":
        if (!form) return null;
        return (
          <SettingsModelsPage
            settings={s}
            defaultBackend={form.defaultBackend}
            setDefaultBackend={(next) => updateForm("defaultBackend", next)}
            clearSaveError={clearSaveError}
          />
        );
      case "threads":
        if (!form) return null;
        return (
          <SettingsThreadsPage
            keepAlive={form.keepAlive}
            setKeepAlive={(next) => updateForm("keepAlive", next)}
            maxThreads={form.maxThreads}
            setMaxThreads={(next) => updateForm("maxThreads", next)}
            prompt={form.prompt}
            setPrompt={(next) => updateForm("prompt", next)}
            defaultThreadPrompt={s.defaultThreadPrompt}
            isDefaultPrompt={dirty?.isDefaultPrompt ?? true}
            clearSaveError={clearSaveError}
          />
        );
      case "security":
        if (!form) return null;
        return (
          <SettingsSecurityPage
            mode={form.mode}
            setMode={(next) => updateForm("mode", next)}
            allowedFolders={s.allowedFolders}
            clearSaveError={clearSaveError}
          />
        );
      case "automations":
        if (!form) return null;
        return (
          <SettingsAutomationsPage
            rules={form.rules}
            setRules={(next) => updateForm("rules", next)}
            pushOnDone={s.pushOnDone}
            clearSaveError={clearSaveError}
          />
        );
      case "shortcuts":
        return <SettingsShortcutsPage />;
      case "accounts":
        return <SettingsAccountsPage />;
      case "connectors":
        return <SettingsConnectorsPage />;
      case "team":
        // TeamSettings draws its own cards, one per section.
        return <TeamSettings />;
      case "sync":
        // SyncSettings draws its own cards, one per section. The recent folders live in s.projects.
        return <SyncSettings recentProjects={s.projects.map((p) => p.path)} />;
    }
  }

  function content() {
    if (settings === null && form === null && NEEDS_SETTINGS.has(page)) {
      return (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="flex flex-col gap-5 rounded-xl border border-line-strong bg-panel/85 p-5 shadow-lg backdrop-blur-xl"
        >
          {loadError !== null ? (
            <p className="text-[12.5px] text-danger">Couldn&apos;t load settings: {loadError}</p>
          ) : (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted">
              <Spinner /> Loading settings
            </div>
          )}
        </div>
      );
    }
    // The pages drawn before the server answers never read `settings`.
    return pageBody(settings ?? ({} as SettingsView));
  }

  const open = pageInfo(page);

  return (
    <Modal
      label="Settings"
      onClose={onClose}
      layer="top"
      className="h-full w-full overflow-hidden"
      style={{ background: backdrop }}
    >
      <div
        // The whole panel is the scene photo; a mousedown anywhere on it closes, like a backdrop.
        // The panes below (header, row, footer) stop the event so clicks on them keep working.
        data-human-only
        onMouseDown={onClose}
        className="flex h-full min-h-0 flex-col"
      >
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center justify-between border-b border-line bg-panel/80 px-5 py-3 backdrop-blur-xl"
        >
          <h2 className="text-[15px] font-medium text-ink">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <nav
            aria-label="Settings pages"
            onMouseDown={(e) => e.stopPropagation()}
            className="flex w-[200px] shrink-0 flex-col gap-0.5 self-start rounded-xl border border-line-strong bg-panel/80 p-2 shadow-lg backdrop-blur-xl"
          >
            {SETTINGS_PAGES.map((p) => {
              const active = p.id === page;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setPage(p.id)}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] ${
                    active ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-sunken hover:text-ink"
                  }`}
                >
                  {p.label}
                  {dirtyPages.has(p.id) && <SettingsUnsavedDot />}
                </button>
              );
            })}
          </nav>

          <div className="flex h-full min-h-0 min-w-0 max-w-[760px] flex-1 flex-col gap-4 overflow-y-auto pb-4 pr-2">
            <div className="px-1 pt-1 [text-shadow:0_1px_8px_rgb(0_0_0/0.35)]">
              <h2 className="text-[22px] font-semibold text-ink">{open.label}</h2>
              <p className="text-[13px] text-ink/80">{open.hint}</p>
            </div>
            {content()}
          </div>
        </div>

        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-panel/80 px-5 py-3 backdrop-blur-xl"
        >
          {saveError && <p className="mr-auto min-w-0 break-words text-[12.5px] text-danger">{saveError}</p>}
          <button
            onClick={onClose}
            className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={settings === null || form === null || saving}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Spinner size={12} />}
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
