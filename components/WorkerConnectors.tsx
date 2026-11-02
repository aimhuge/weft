"use client";

// A worker's Connectors menu in Settings → Devices (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built):
// one small badge on the worker's row ("GitHub ✓" when on) that opens the settings in place, so the list grows no rows.
// Connect GitHub (once, on weft.zip, in the browser pane), turn it on for this worker (Touch ID in main), and choose
// Scope, Approval, Lifetime and which actions ask; projects or cards waiting for an Allow, and when it was last used.
import { useState } from "react";
import { APPROVAL_LABEL, APPROVALS, ASK_LABEL, ASKS, DEFAULT_SETTINGS, LIFETIME_LABEL, LIFETIMES, SCOPE_LABEL, SCOPES, type GrantSettings } from "@/lib/connector-grant";
import { timeAgo } from "@/lib/format";
import type { WorkerConnector } from "@/lib/connector-view";
import type { WorkerConnectors as Connectors } from "@/lib/use-worker-connectors";

const BADGE = "rounded-full border border-line-strong px-2 py-0.5 text-[11.5px] text-ink hover:bg-sunken";
const BUTTON = "rounded-md border border-line-strong px-2 py-0.5 text-[12px] text-ink hover:bg-sunken disabled:opacity-50";
const SUBTLE = "text-[11.5px] text-muted";

function Choice<T extends string>({ label, list, names, value, onPick, disabled }: { label: string; list: readonly T[]; names: Record<T, string>; value: T; onPick: (v: T) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`w-16 shrink-0 ${SUBTLE}`}>{label}</span>
      {list.map((v) => (
        <button key={v} type="button" disabled={disabled} aria-pressed={v === value} className={`${BUTTON} ${v === value ? "bg-sunken font-medium" : ""}`} onClick={() => v !== value && onPick(v)}>
          {names[v]}
          {v === value ? " ✓" : ""}
        </button>
      ))}
    </div>
  );
}

function Settings({ c, g, workerId, name, now }: { c: Connectors; g: WorkerConnector; workerId: string; name: string; now: number }) {
  const s = g.settings;
  const put = (patch: Partial<GrantSettings>) => void c.set(workerId, name, { ...s, ...patch });
  const toggleAsk = (a: (typeof ASKS)[number]) => put({ asks: s.asks.includes(a) ? s.asks.filter((x) => !Object.is(x, a)) : [...s.asks, a] });
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <Choice label="Scope" list={SCOPES} names={SCOPE_LABEL} value={s.scope} onPick={(scope) => put({ scope })} disabled={!c.canChange} />
      <Choice label="Approval" list={APPROVALS} names={APPROVAL_LABEL} value={s.approval} onPick={(approval) => put({ approval })} disabled={!c.canChange} />
      <Choice label="Lifetime" list={LIFETIMES} names={LIFETIME_LABEL} value={s.lifetime} onPick={(lifetime) => put({ lifetime })} disabled={!c.canChange} />
      <div className="flex flex-wrap items-center gap-1">
        <span className={`w-16 shrink-0 ${SUBTLE}`}>Ask before</span>
        {ASKS.map((a) => (
          <label key={a} className="flex items-center gap-1 text-[12px] text-ink">
            <input type="checkbox" checked={s.asks.includes(a)} disabled={!c.canChange} onChange={() => toggleAsk(a)} /> {ASK_LABEL[a]}
          </label>
        ))}
      </div>
      <p className={SUBTLE}>
        {s.scope === "installed" ? "Every repo the Weft app is installed on, as you." : "One repo per token, still as you."}
        {" Deleting a repo can't happen: the app has no admin permission."}
        {g.expiresAt ? ` Ends ${new Date(g.expiresAt).toLocaleString()}.` : ""}
        {g.lastUsedAt ? ` Last used ${timeAgo(Date.parse(g.lastUsedAt), now)}${g.lastRepo ? ` on ${g.lastRepo}` : ""}.` : " Not used yet."}
      </p>
      {g.pending.map((p) => (
        <div key={`${p.kind}:${p.subject}`} className="flex items-center gap-2 text-[12px] text-ink">
          <span className="min-w-0 truncate">
            Waiting: {p.kind} {p.label}
          </span>
          <button type="button" className={BUTTON} disabled={!c.canChange} onClick={() => void c.allow(name, g.grantId, p)}>
            Allow
          </button>
        </div>
      ))}
    </div>
  );
}

// The menu's first line: GitHub's account, and Connect, Turn on or Turn off.
function Header({ c, workerId, name, on }: { c: Connectors; workerId: string; name: string; on: boolean }) {
  const github = c.view?.github;
  const action = !github?.connected
    ? { label: "Connect GitHub", run: c.connect, disabled: false }
    : on
      ? { label: "Turn off", run: () => void c.off(workerId, name), disabled: false }
      : { label: "Turn on", run: () => void c.set(workerId, name, DEFAULT_SETTINGS), disabled: !c.canChange };
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink">GitHub, as you with Weft{github?.login ? ` (@${github.login})` : ""}</span>
        <button type="button" className={BUTTON} disabled={action.disabled} onClick={action.run}>
          {action.label}
        </button>
      </div>
      {!github?.connected && <p className={`mt-1 ${SUBTLE}`}>{github?.error ?? "Install the Weft app on the repos you pick, then authorize it once. Your GitHub sign-in stays on weft.zip; workers get short tokens."}</p>}
    </>
  );
}

export default function WorkerConnectors({ c, workerId, name, now }: { c: Connectors; workerId: string; name: string; now: number }) {
  const [open, setOpen] = useState(false);
  const grant = c.view?.workers[workerId];
  const on = Boolean(grant);
  if (!c.view?.signedIn) return null;
  return (
    <div className="relative">
      <button type="button" className={BADGE} aria-expanded={open} aria-label={`Connectors on ${name}`} onClick={() => setOpen((o) => !o)}>
        {on ? "GitHub ✓" : "Connectors"}
      </button>
      {open && (
        <div role="dialog" aria-label={`Connectors on ${name}`} className="absolute right-0 z-20 mt-1 w-[26rem] max-w-[90vw] rounded-lg border border-line bg-panel p-3 shadow-lg">
          <Header c={c} workerId={workerId} name={name} on={on} />
          {grant && <Settings c={c} g={grant} workerId={workerId} name={name} now={now} />}
          {c.note && <p className="mt-2 text-[12px] text-ink">{c.note}</p>}
          {c.error && <p className="mt-2 text-[12px] text-danger">{c.error}</p>}
        </div>
      )}
    </div>
  );
}
