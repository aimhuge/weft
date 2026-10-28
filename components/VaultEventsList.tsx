"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import {
  actorName,
  eventLine,
  filterEvents,
  mergeEvents,
  toVaultEvents,
  type VaultEvent,
  type VaultEventScope,
  type VaultEventsResult,
  type VaultEventsShell,
} from "@/lib/vault-events";
import { Note } from "./VaultParts";

// The 🔐 drawer's Event log tab (docs/architecture/teams-vault.md, "What the 🔐 drawer shows" and Q14):
// the last hundred rows of the shared vault's audit log, newest first, and the live feed that appends
// them while the tab is open.
//
// A row says who did what and never a value: the board asks main for named columns only, so nothing
// about a secret's value can reach this tab. The rows are windowed, so a hundred of them cost the
// same to draw as a dozen.
//
// The filter is the current user's own actions by default and every member's on request: "Sam changed
// this on Tuesday" is one click from the secret itself.

const ROW_HEIGHT = 30;
// How many rows to draw above and below the window, so a scroll doesn't show blank edges.
const OVERSCAN = 6;

// The scope buttons, in the order they sit.
const SCOPES: { id: VaultEventScope; label: string; title: string }[] = [
  { id: "mine", label: "My actions", title: "What you did in this vault" },
  { id: "all", label: "All members", title: "What everyone in the workspace did" },
];

// What the tab needs from the shell: the log, and the live feed. Both are missing in a shell from
// before the tab, and the tab says so rather than showing an empty log.
export type VaultEventsBridge = VaultEventsShell;

// The drawer's two tabs, in the order they sit. The switcher lives here, next to the tab it
// controls, so the drawer only has to say which one is open.
export type VaultTab = "secrets" | "events";

const TABS: { id: VaultTab; label: string }[] = [
  { id: "secrets", label: "Secrets" },
  { id: "events", label: "Event log" },
];

// The switcher: two small tabs, in the drawer's own row. No new chrome on the rail.
export function VaultTabs({ tab, onTab }: { tab: VaultTab; onTab: (tab: VaultTab) => void }) {
  return (
    <div role="tablist" aria-label="Vault tabs" className="flex gap-1 border-b border-line px-2 pt-1.5">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onTab(t.id)}
          className={`rounded-t px-2 py-1 text-[11.5px] ${tab === t.id ? "border-b-2 border-accent text-ink" : "text-muted hover:text-ink"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function VaultEventsList({
  bridge,
  vaultId,
  vaultLabel,
}: {
  bridge: VaultEventsBridge | null;
  // The vault's local id ("github:owner/name"), which main turns into the server's vault.
  vaultId: string;
  // The vault's name, for the empty states.
  vaultLabel: string;
}) {
  const [events, setEvents] = useState<VaultEvent[]>([]);
  const [scope, setScope] = useState<VaultEventScope>("mine");
  const [shared, setShared] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The signed-in user's id, for the "mine" filter on the live feed's rows.
  const [userId, setUserId] = useState<string | null>(null);

  // The log for a scope: the newest rows, and the filter that goes with them. The read happens in
  // the effect below, so the state is only written once the shell has answered.
  const load = useCallback(
    (next: VaultEventScope): Promise<VaultEventsResult | null> => {
      if (!bridge) return Promise.resolve(null);
      return bridge.events(vaultId, { scope: next });
    },
    [bridge, vaultId],
  );

  // The tab opens on the user's own actions, and re-reads when the filter changes.
  useEffect(() => {
    let live = true;
    void load(scope)
      .then((result) => {
        if (!live || !result) return;
        // Main already filtered the read by the scope; the same gate is applied here, so a row that
        // slipped through never reaches the list.
        setEvents(filterEvents(result.events, scope, result.userId ?? null));
        setShared(result.shared !== false);
        setUserId(result.userId ?? null);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [load, scope]);

  // The live feed: main pushes the rows that land, and they go in front of the ones already there.
  useEffect(() => {
    if (!bridge) return;
    const stop = bridge.onEvents?.((payload) => {
      if (payload.vaultId !== vaultId) return;
      const arrived = toVaultEvents(payload.rows);
      setEvents((now) => mergeEvents(now, arrived, scope, userId));
    });
    void bridge.watchEvents?.(vaultId, scope);
    return () => {
      stop?.();
      void bridge.unwatchEvents?.(vaultId);
    };
  }, [bridge, vaultId, scope, userId]);

  // The filter: a new scope means a new read, so the log says it's reading. The rows already shown
  // are re-filtered under the new scope at once, so the tab doesn't show a teammate's actions for
  // the moment before the new read lands.
  const changeScope = (next: VaultEventScope) => {
    setLoading(true);
    setEvents((now) => filterEvents(now, next, userId));
    setScope(next);
  };

  if (!bridge) return <Note>The event log lives in Weft&apos;s desktop app.</Note>;
  if (error) return <Note>{error}</Note>;
  if (!shared) return <Note>{vaultLabel} isn&apos;t shared with a workspace yet, so it has no event log.</Note>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScopeFilter scope={scope} onScope={changeScope} />
      {loading && events.length === 0 ? (
        <Note>Reading the log…</Note>
      ) : events.length === 0 ? (
        <Note>{scope === "mine" ? "You haven’t changed anything in this vault yet." : "Nothing has happened in this vault yet."}</Note>
      ) : (
        <EventRows events={events} />
      )}
    </div>
  );
}

// The filter: the user's own actions, or every member's.
function ScopeFilter({ scope, onScope }: { scope: VaultEventScope; onScope: (scope: VaultEventScope) => void }) {
  return (
    <div role="group" aria-label="Event log filter" className="flex gap-1 px-3 pt-2">
      {SCOPES.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={scope === s.id}
          title={s.title}
          onClick={() => onScope(s.id)}
          className={`rounded-md border px-1.5 py-0.5 text-[11px] ${scope === s.id ? "border-accent bg-accent/15 text-ink" : "border-line-strong text-muted hover:text-ink"}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// The rows, windowed: only the ones on screen are drawn, so a hundred of them cost the same as a
// dozen. The scroll height is the whole list's, so the scrollbar is the list's.
function EventRows({ events }: { events: VaultEvent[] }) {
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(240);
  const box = useRef<HTMLDivElement>(null);

  // The window's size follows the drawer, which is short on a laptop screen.
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => setHeight(node.clientHeight || 240);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => setTop(e.currentTarget.scrollTop);
  const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const count = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2;
  const shown = events.slice(first, first + count);
  // The clock the ages read from. It is 0 before the board is in the browser, and then the row
  // shows no age at all rather than a wrong one.
  const now = useNow();

  return (
    <div ref={box} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <div style={{ height: events.length * ROW_HEIGHT, position: "relative" }}>
        {shown.map((event, n) => (
          <EventRow key={event.id || `${first + n}`} event={event} top={(first + n) * ROW_HEIGHT} now={now} />
        ))}
      </div>
    </div>
  );
}

// One row: who did what, and when.
function EventRow({ event, top, now }: { event: VaultEvent; top: number; now: number }) {
  const when = event.createdAt && now ? timeAgo(Date.parse(event.createdAt), now) : "";
  return (
    <div
      className="absolute inset-x-0 flex items-baseline gap-1.5 overflow-hidden px-1 text-[11.5px] leading-[30px]"
      style={{ top, height: ROW_HEIGHT }}
      title={`${actorName(event)} ${eventLine(event)}${when ? ` · ${when}` : ""}`}
    >
      <span className="shrink-0 font-medium text-ink">{actorName(event)}</span>
      <span className="min-w-0 flex-1 truncate text-muted">{eventLine(event)}</span>
      <span className="shrink-0 text-faint">{when}</span>
    </div>
  );
}
