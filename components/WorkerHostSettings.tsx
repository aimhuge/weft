"use client";

// One of your Weft Workers' own settings, on Settings → Threads (docs/architecture/project-hosts.md#settings-on-a-worker-wp3):
// how many threads it runs at once, how long it keeps a CLI open, its worktree pool and its default CLI. Pick a worker,
// its settings load from it (settings.get), and Save sends the changes (settings.put). Automations, /weft:done's model,
// the thread instructions and the rest of your account's settings sync to it from this Mac's own; its folders, modes
// and guards are only ever set on that machine.
import { useEffect, useState } from "react";
import type { HostSettings } from "@weft/client";
import { BACKENDS } from "@/lib/new-thread";
import { KEEP_ALIVE, MAX_THREADS_CHOICES } from "@/lib/settings-shared";
import { useWorkers } from "@/lib/use-workers";
import { workerSettings } from "@/lib/worker-host-settings";
import { SELECT_CLASS } from "./ModelSelect";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";
import { BUTTON_PRIMARY_SMALL } from "./button-styles";

const POOL = [0, 1, 2, 3];

// The choices for a number, with the value it holds added when it's off the list.
const withValue = (list: number[], value: number) => (list.includes(value) ? list : [...list, value]);

function Field({ label, value, options, onChange }: { label: string; value: string | number; options: { value: string | number; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 text-[13px] text-ink">
      {label}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// What a worker said its settings are, or why it couldn't, keyed by the worker it came from.
type Loaded = { id: string; settings?: HostSettings; error?: string };

// One worker's settings as loaded, the edits on top of them, and Save.
function useHostForm(workerId: string) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [edits, setEdits] = useState<{ id: string; form: HostSettings } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!workerId) return;
    let live = true;
    workerSettings(workerId).then(
      (settings) => {
        if (live) setLoaded({ id: workerId, settings });
      },
      (err: unknown) => {
        if (live) setLoaded({ id: workerId, error: (err as Error).message });
      },
    );
    return () => {
      live = false;
    };
  }, [workerId]);

  const mine = loaded?.id === workerId ? loaded : null;
  const saved = mine?.settings ?? null;
  const form = edits?.id === workerId ? edits.form : saved;
  const changed = form && saved ? (Object.keys(form) as (keyof HostSettings)[]).filter((k) => form[k] !== saved[k]) : [];
  const error = (saveError?.id === workerId ? saveError.message : null) ?? mine?.error ?? null;
  const set = <K extends keyof HostSettings>(key: K, value: HostSettings[K]) => form && setEdits({ id: workerId, form: { ...form, [key]: value } });

  async function save() {
    if (!form || !changed.length) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await workerSettings(workerId, Object.fromEntries(changed.map((k) => [k, form[k]])));
      setLoaded({ id: workerId, settings: next });
      setEdits(null);
    } catch (err) {
      setSaveError({ id: workerId, message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return { form, set, changed, busy: saving || !mine, error, save };
}

function HostFields({ form, set }: { form: HostSettings; set: ReturnType<typeof useHostForm>["set"] }) {
  return (
    <>
      <Field label="Threads running at once" value={form.maxThreads} options={withValue(MAX_THREADS_CHOICES, form.maxThreads).map((n) => ({ value: n, label: n === 0 ? "No limit" : `${n} threads` }))} onChange={(v) => set("maxThreads", Number(v))} />
      <Field label="Keep conversations open" value={form.keepAliveMinutes} options={withValue(KEEP_ALIVE.map((o) => o.minutes), form.keepAliveMinutes).map((m) => ({ value: m, label: KEEP_ALIVE.find((o) => o.minutes === m)?.label ?? `${m} minutes` }))} onChange={(v) => set("keepAliveMinutes", Number(v))} />
      <Field label="Ready worktrees per repo" value={form.worktreePool} options={POOL.map((n) => ({ value: n, label: n ? String(n) : "Off" }))} onChange={(v) => set("worktreePool", Number(v))} />
      <Field label="Default CLI" value={form.defaultBackend} options={BACKENDS.map((b) => ({ value: b.id, label: b.label }))} onChange={(v) => set("defaultBackend", v)} />
    </>
  );
}

export default function WorkerHostSettings() {
  const { view } = useWorkers();
  const workers = (view?.workers ?? []).filter((w) => w.mine && w.kind === "headless");
  const [picked, setPicked] = useState<string>("");
  const workerId = picked || workers[0]?.id || "";
  const { form, set, changed, busy, error, save } = useHostForm(workerId);
  if (!workers.length) return null;

  return (
    <SettingsCard>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <SettingsSectionHeader title="On a worker" hint="A worker's own threads, warm CLIs and worktrees. Automations, the done model and thread instructions sync from this Mac." />
          <select aria-label="Worker" value={workerId} onChange={(e) => setPicked(e.target.value)} className={SELECT_CLASS}>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        {form && <HostFields form={form} set={set} />}
        <div className="flex items-center justify-end gap-3">
          {busy && <span className="text-[12px] text-muted">Asking the worker…</span>}
          {error && <span className="mr-auto text-[12px] text-danger">{error}</span>}
          <button type="button" onClick={() => void save()} disabled={busy || !changed.length} className={BUTTON_PRIMARY_SMALL}>
            Save on worker
          </button>
        </div>
      </section>
    </SettingsCard>
  );
}
