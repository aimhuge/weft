"use client";

import { useEffect, useRef } from "react";
import { hostFor } from "@/lib/project-host";
import { useCountdown } from "@/lib/use-countdown";
import {
  badSecretName,
  deliveryLabel,
  deliveryOk,
  deliveryTitle,
  eventsText,
  folderOptions,
  formReady,
  isBlank,
  isFailing,
  relayState,
  shortTarget,
  type WebhookForm,
} from "@/lib/webhooks-view";
import type { Webhook } from "@/lib/webhooks";
import CountdownButton, { CONFIRM_WAIT_MS } from "./CountdownButton";
import { Tag } from "./VaultParts";

// The pieces of the 🪝 drawer (components/WebhooksDrawer.tsx): its project filter, the Add form and a webhook's row.

const FIELD = "w-full rounded-md border border-line-strong bg-card px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-60";

// The drawer's "Filter by project", like the vault's: follows the top bar's project until you pick here
// (picked). Hidden with only one project on the board.
export function WebhookProjectFilter({ folders, value, picked, onPick }: { folders: string[]; value: string; picked: boolean; onPick: (folder: string | null) => void }) {
  if (folders.length < 2) return null;
  return (
    <label className="mx-3 mt-2 flex items-center gap-1.5 text-[11px] text-muted">
      <span className="shrink-0">Project</span>
      <select
        value={value}
        onChange={(e) => onPick(e.target.value || null)}
        aria-label="Filter by project"
        title={picked ? "Picked here; choosing a project in the top bar sets it again" : "Follows the project picked in the top bar"}
        className="min-w-0 flex-1 rounded-md border border-line-strong bg-card px-1.5 py-0.5 text-[11.5px] text-ink"
      >
        {folderOptions(folders).map((o) => (
          <option key={o.folder} value={o.folder}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// Adding one by hand: what it's called, the local route it reaches, and (optional) the events, where to
// register it and the vault name of its signing secret. Enter adds, Cancel closes.
export function AddWebhookForm({ form, busy, onChange, onSave, onCancel }: { form: WebhookForm; busy: boolean; onChange: (next: WebhookForm) => void; onSave: () => void; onCancel: () => void }) {
  const ready = formReady(form) && !busy;
  const set = (key: keyof WebhookForm) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...form, [key]: e.target.value });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSave();
      }}
      className="mx-1 mt-1.5 flex flex-col gap-2 rounded-md border border-line bg-sunken p-2.5"
    >
      <input value={form.name} onChange={set("name")} autoFocus placeholder="Name, e.g. stripe" aria-label="Name" autoComplete="off" spellCheck={false} className={FIELD} />
      <input value={form.target} onChange={set("target")} placeholder="/api/stripe/webhook" aria-label="Local route" autoComplete="off" spellCheck={false} className={`${FIELD} font-mono`} />
      <input value={form.events} onChange={set("events")} placeholder="Events, comma separated" aria-label="Events" autoComplete="off" spellCheck={false} className={FIELD} />
      <input value={form.hint} onChange={set("hint")} placeholder="Where to register it" aria-label="Where to register it" autoComplete="off" className={FIELD} />
      <input
        value={form.secret}
        onChange={set("secret")}
        placeholder="STRIPE_WEBHOOK_SECRET (its vault name)"
        aria-label="Signing secret's name"
        autoComplete="off"
        spellCheck={false}
        className={`${FIELD} font-mono ${badSecretName(form) ? "border-warn" : ""}`}
      />
      {badSecretName(form) && <p className="-mt-1 text-[10.5px] leading-snug text-warn">Letters, digits and _, not starting with a digit.</p>}
      <div className="flex gap-1.5">
        <button type="submit" disabled={!ready} className="flex-1 rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-on-accent disabled:opacity-50">
          Add webhook
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-card hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

export interface RowActions {
  onToggle: () => void;
  onCopy: (url: string) => void;
  onRelay: () => void;
  onUnrelay: () => void;
  onRegistered: (registered: boolean) => void;
  onRemove: () => void;
}

// One webhook: name, pills and its short target; clicking opens the rest. highlight is a thread's ask: the row
// scrolls into view and wears the accent ring.
export function WebhookRow({ hook: h, expanded, highlight, signedIn, busy, now, actions }: { hook: Webhook; expanded: boolean; highlight: boolean; signedIn: boolean; busy: boolean; now: number; actions: RowActions }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  const events = eventsText(h.events);
  return (
    <div ref={ref} className={`rounded ${highlight ? "ring-1 ring-accent" : ""}`}>
      <button onClick={actions.onToggle} aria-expanded={expanded} className="block w-full rounded px-1.5 py-1 text-left hover:bg-sunken">
        <span className="flex items-center gap-1.5 text-[12px]">
          <span className="min-w-0 flex-1 truncate font-medium text-ink" title={h.name}>
            {h.name}
          </span>
          {isFailing(h) && <Tag tone="warn">failing</Tag>}
          {isBlank(h) && <Tag tone="warn">blank</Tag>}
        </span>
        <span className="block truncate font-mono text-[10.5px] text-faint" title={h.target}>
          {shortTarget(h.target)}
          {events && <span className="font-sans"> · {events}</span>}
        </span>
      </button>
      {expanded && <WebhookDetail hook={h} signedIn={signedIn} busy={busy} now={now} actions={actions} />}
    </div>
  );
}

// The public URL, or the button that gets one. A worker's relay is made by a thread there (lib/relay-worker.ts), so
// only its URL shows here.
function RelayLine({ hook: h, relay, here, busy, actions }: { hook: Webhook; relay: ReturnType<typeof relayState>; here: boolean; busy: boolean; actions: RowActions }) {
  if (!here) return <p className="text-faint">{h.url ? <code className="select-all text-ink">{h.url}</code> : "A thread on its worker gets it a public URL."}</p>;
  if (relay === "url" && h.url) {
    const url = h.url;
    return (
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 select-all truncate rounded bg-sunken px-1.5 py-0.5 text-[10.5px] text-ink" title={url}>
          {url}
        </code>
        <button onClick={() => actions.onCopy(url)} className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10.5px] font-medium text-on-accent">
          Copy
        </button>
      </div>
    );
  }
  return (
    <div>
      <button
        onClick={actions.onRelay}
        disabled={relay === "sign-in" || busy}
        title="Forwards a provider's deliveries to your dev server, through the deployed Weft"
        className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-40"
      >
        Get a public URL
      </button>
      {relay === "sign-in" && <p className="mt-0.5 text-faint">Sign in to your Weft account to get one.</p>}
    </div>
  );
}

function WebhookDetail({ hook: h, signedIn, busy, now, actions }: { hook: Webhook; signedIn: boolean; busy: boolean; now: number; actions: RowActions }) {
  const { left, arm, disarm } = useCountdown(CONFIRM_WAIT_MS);
  const relay = relayState(h, signedIn);
  const relayHere = hostFor(h.folder).can("relay");
  const link = "text-[11px] text-muted hover:text-ink disabled:opacity-40";
  return (
    <div onMouseLeave={disarm} className="mx-1.5 mb-1.5 mt-0.5 flex flex-col gap-1.5 border-l border-line pl-2 text-[11px] leading-snug text-muted">
      <RelayLine hook={h} relay={relay} here={relayHere} busy={busy} actions={actions} />
      {h.hint && <p>{h.hint}</p>}
      {h.secret && (
        <p>
          Signing secret <code className="text-ink">{h.secret}</code> in 🔐
        </p>
      )}
      {h.url && (
        <div>
          <h4 className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Deliveries</h4>
          {h.deliveries?.length ? (
            <ul>
              {h.deliveries.slice(0, 5).map((d, i) => (
                <li key={`${d.at}-${i}`} title={deliveryTitle(d)} className="flex items-center gap-1.5">
                  <span className={`size-1.5 shrink-0 rounded-full ${deliveryOk(d) ? "bg-accent" : "bg-warn"}`} aria-hidden />
                  <span className="font-mono text-[10.5px] text-faint">{d.method}</span>
                  <span className={deliveryOk(d) ? "text-ink" : "text-warn"}>{deliveryLabel(d, now)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-faint">None yet.</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
        <button onClick={() => actions.onRegistered(!h.registered)} disabled={busy} className={link} title={h.registered ? "The provider no longer sends to it" : "You added it at the provider"}>
          {h.registered ? "Not registered" : "Mark registered"}
        </button>
        {h.url && relayHere && (
          <button onClick={actions.onUnrelay} disabled={busy} className={link} title="Take the public URL down">
            Stop relay
          </button>
        )}
        {left !== null ? (
          <CountdownButton
            left={left}
            label="Remove"
            ariaLabel={`Confirm removing ${h.name}`}
            title={`Remove ${h.name}`}
            onConfirm={() => {
              disarm();
              actions.onRemove();
            }}
            className="px-1.5 text-[10.5px]"
          />
        ) : (
          <button onClick={arm} disabled={busy} className={link} aria-label={`Remove ${h.name}`}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
