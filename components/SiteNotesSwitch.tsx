"use client";

import { useEffect, useState } from "react";
import { call } from "@/lib/client-api";

// Settings → Security → Site notes (docs/architecture/site-notes.md#consent). Notes stay on this Mac and go to your
// team on their own; sharing them with every Weft user is this switch, off until you turn it on. Each note waits
// here, scrubbed and scanned, until you've read exactly what it sends and press Send.

type OutboxItem = { id: string; host: string; path: string; body: string };
type State = { public: boolean; outbox: OutboxItem[] };

export function SiteNotesSwitch() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    call<State>("GET", "/api/site-notes").then(
      (r) => live && setState(r),
      () => live && setState({ public: false, outbox: [] }),
    );
    return () => {
      live = false;
    };
  }, []);
  const toggle = () => {
    if (!state) return;
    const next = !state.public;
    setState({ ...state, public: next });
    call<State>("PUT", "/api/site-notes", { on: next }).then(setState, () => setState({ ...state, public: !next }));
  };
  const act = (action: "send" | "discard", ids?: string[]) => {
    setBusy(true);
    call<{ outbox: OutboxItem[] }>("POST", "/api/site-notes", { action, ids })
      .then((r) => setState((s) => (s ? { ...s, outbox: r.outbox } : s)))
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const outbox = state?.outbox ?? [];
  return (
    <div className="mt-2 space-y-2 text-[11.5px] text-muted">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={state?.public ?? false} disabled={!state} onChange={toggle} className="accent-accent" />
        Share site notes with every Weft user, after I read each one. Scrubbed of ids, emails and keys.
      </label>
      {state?.public && outbox.length > 0 && (
        <div className="space-y-1">
          {outbox.map((item) => (
            <details key={item.id} className="rounded border border-border px-2 py-1">
              <summary className="cursor-pointer truncate">
                {item.host}
                {item.path}
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px]">{item.body}</pre>
              <div className="mt-1 flex gap-2">
                <button type="button" disabled={busy} className="text-accent" onClick={() => act("send", [item.id])}>
                  Send
                </button>
                <button type="button" disabled={busy} onClick={() => act("discard", [item.id])}>
                  Discard
                </button>
              </div>
            </details>
          ))}
          {outbox.length > 1 && (
            <button type="button" disabled={busy} className="text-accent" onClick={() => act("send")}>
              Send all {outbox.length}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
