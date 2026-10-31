"use client";

import { useEffect, useState } from "react";
import { folderName } from "@/lib/format";
import { onWebhookAsk, type useWebhooks } from "@/lib/use-webhooks";
import { vaultFilter, type VaultFilterPick } from "@/lib/vault-view";
import { emptyForm, filterWebhooks, formInput, groupByFolder, type WebhookForm } from "@/lib/webhooks-view";
import Icon from "./Icon";
import TunnelSection from "./TunnelSection";
import { Note } from "./VaultParts";
import { AddWebhookForm, WebhookProjectFilter, WebhookRow } from "./WebhookParts";

type Webhooks = ReturnType<typeof useWebhooks>;

// The 🪝 drawer's body (docs/architecture/webhooks.md): per project, the webhooks its code receives. A thread
// adds them (mcp__webhooks__*); a blank one waits for you to register its URL with the provider. A webhook
// gets a public URL (a relay on the deployed Weft) that forwards the provider's deliveries to the dev server,
// and the latest deliveries show under it. Shows the top bar's project, or the one you pick here.
export default function WebhooksDrawer({
  hooks,
  signedIn,
  loaded,
  error,
  reload,
  add,
  update,
  remove,
  relay,
  unrelay,
  project,
  folders,
  notify,
}: Pick<Webhooks, "hooks" | "signedIn" | "loaded" | "error" | "reload" | "add" | "update" | "remove" | "relay" | "unrelay"> & {
  // The top bar's project, which the filter follows by default.
  project: string | null;
  // Every project on the board.
  folders: string[];
  // Shows an error or a short message as a toast.
  notify: (err: unknown) => void;
}) {
  const [pick, setPick] = useState<VaultFilterPick | null>(null);
  const [adding, setAdding] = useState<{ folder: string; form: WebhookForm } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // The row a thread asked about: ringed until you open another.
  const [asked, setAsked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The deliveries' relative times move on with each poll, which hands in a new list.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  // A thread's ask (lib/use-webhooks.ts): expand its webhook, in the project the filter then shows. Served once the
  // webhook is in the list; until then it asks for a fresh list (the thread has just added it).
  useEffect(
    () =>
      onWebhookAsk((ask) => {
        if (!loaded) return false;
        if (!ask) return true;
        const hook = hooks.find((h) => h.id === ask.id);
        if (!hook) {
          void reload();
          return false;
        }
        if (filterWebhooks([hook], vaultFilter(project, pick)).length === 0) setPick({ top: project, folder: hook.folder });
        setExpanded(hook.id);
        setAsked(hook.id);
        return true;
      }),
    [loaded, hooks, project, pick, reload],
  );

  if (error && !loaded) return <Note>{error}</Note>;
  if (!loaded) return <Note>Loading webhooks…</Note>;
  if (!folders.length) return <Note>Add a project to the board to keep its webhooks here.</Note>;

  const filter = vaultFilter(project, pick);
  const sections = groupByFolder(filterWebhooks(hooks, filter), filter ? [filter] : folders);
  const filterValue = filter && sections[0] ? sections[0].folder : "";

  // Runs a change, then toasts a failure; id marks the row it busies.
  async function change(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    try {
      await run();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(null);
    }
  }

  async function save(folder: string, form: WebhookForm) {
    await change("add", async () => {
      const { hook, existed } = await add(formInput(folder, form));
      setAdding(null);
      setExpanded(hook.id);
      if (existed) notify(`${hook.name} was already here; opened it`);
    });
  }

  function copy(url: string) {
    navigator.clipboard.writeText(url).then(
      () => notify("Copied the public URL"),
      (err: unknown) => notify(err),
    );
  }

  const nothing = sections.every((s) => s.hooks.length === 0) && !adding;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WebhookProjectFilter folders={folders} value={filterValue} picked={pick?.top === project} onPick={(folder) => setPick({ top: project, folder })} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {error && <p className="mt-2 px-1 text-[11px] text-danger">{error}</p>}
        {nothing && <Note>Threads add the webhooks your code receives. A public URL forwards a provider&apos;s deliveries to your dev server.</Note>}
        {sections.map((s) => (
          <section key={s.folder} className="mt-2">
            <div className="flex items-center gap-1 px-1.5">
              <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink" title={s.folder}>
                {s.label}
              </h3>
              <button
                onClick={() => setAdding({ folder: s.folder, form: emptyForm() })}
                title={`Add a webhook to ${folderName(s.folder)} by hand`}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink"
              >
                <Icon name="plus" size={11} /> Add
              </button>
            </div>
            <TunnelSection folder={s.folder} notify={notify} />
            {adding?.folder === s.folder && (
              <AddWebhookForm form={adding.form} busy={busy === "add"} onChange={(form) => setAdding({ folder: s.folder, form })} onSave={() => void save(s.folder, adding.form)} onCancel={() => setAdding(null)} />
            )}
            {s.hooks.map((h) => (
              <WebhookRow
                key={h.id}
                hook={h}
                expanded={expanded === h.id}
                highlight={asked === h.id}
                signedIn={signedIn}
                busy={busy === h.id}
                now={now}
                actions={{
                  onToggle: () => {
                    setExpanded(expanded === h.id ? null : h.id);
                    setAsked(null);
                  },
                  onCopy: copy,
                  onRelay: () => void change(h.id, () => relay(h.id)),
                  onUnrelay: () => void change(h.id, () => unrelay(h.id)),
                  onRegistered: (registered) => void change(h.id, () => update(h.id, { registered })),
                  onRemove: () =>
                    void change(h.id, async () => {
                      await remove(h.id);
                      notify(`Removed ${h.name}`);
                    }),
                }}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
