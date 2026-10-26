"use client";

// Settings → Security: who used the Keychain and the 🔐 vault (docs/architecture/secrets.md#audit-log). The threads
// with standing access come first, each with Revoke; then the audit log, newest first: every time Weft opened
// something it keeps in the Keychain, and every secret revealed, copied, typed, run with, pushed or written, by you,
// a thread or Weft, each naming whose it was. Names only. The log is kept in your Weft account (keychain_events,
// read by lib/keychain-audit-record.ts), not on the Mac, which holds a line only until it uploads
// (lib/keychain-audit-sync.ts): those show as waiting, a line that reached the account late says so, and a number a
// Mac skipped shows as a gap. The line under it says where the log is kept.

import { Fragment, useMemo, useState } from "react";
import { auditNote, auditSentence, auditVia, gapLine, grantLeft, mergeLog, seqGaps, syncLine, type AuditEntry, type VaultGrant } from "@/lib/keychain-audit-view";
import { useKeychainAccess } from "@/lib/use-keychain-access";
import { useNow } from "@/lib/use-now";
import { SettingsSectionHeader } from "./SettingsLayout";

// Rows shown before Show more, and how many more each press adds.
const PAGE = 40;

// "14:05" today, "Oct 24 14:05" before.
function when(iso: string, now: number): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return new Date(now).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export default function KeychainAccess() {
  const now = useNow();
  const { supported, activity, record, grants, error, revoke } = useKeychainAccess();
  const [shown, setShown] = useState(PAGE);
  const entries = useMemo(() => mergeLog(record?.entries ?? [], activity?.entries ?? [], record?.owner ?? null), [record, activity]);
  const gaps = useMemo(() => seqGaps(entries), [entries]);

  return (
    <section className="flex flex-col gap-2.5">
      <SettingsSectionHeader
        title="Keychain access"
        hint="Every time Weft opens something it keeps in the Keychain, and every time a vault secret is used, by you, a thread or Weft. Names only, never values."
      />
      {!supported && <p className="text-[12.5px] text-muted">The log lives in Weft&apos;s desktop app, beside the vault.</p>}
      {supported && <Grants grants={grants} now={now} onRevoke={(g) => void revoke(g)} />}
      {error && <p className="text-[12.5px] text-warn">{error}</p>}
      {activity && (
        <>
          <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto text-[12px]">
            {!entries.length && <li className="text-muted">Nothing yet.</li>}
            {entries.slice(0, shown).map((e) => (
              <Fragment key={e.id}>
                <Line entry={e} now={now} />
                {gaps.has(e.id) && <li className="pl-[82px] text-warn">{gapLine(gaps.get(e.id) ?? 0)}</li>}
              </Fragment>
            ))}
          </ul>
          {entries.length > shown && (
            <button onClick={() => setShown((n) => n + PAGE)} className="self-start rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink">
              Show more
            </button>
          )}
          <p className="text-[11px] text-muted">{syncLine({ ...activity, signedIn: record?.signedIn ?? false }, (iso) => when(iso, now))}</p>
        </>
      )}
    </section>
  );
}

function Grants({ grants, now, onRevoke }: { grants: VaultGrant[]; now: number; onRevoke: (g: VaultGrant) => void }) {
  if (!grants.length) {
    return <p className="text-[12.5px] text-muted">No thread has standing access. Give one from its card&apos;s right-click menu, or a thread asks with Touch ID.</p>;
  }
  return (
    <ul className="flex flex-col gap-1 text-[12.5px]">
      {grants.map((g) => (
        <li key={`${g.card}-${g.id}`} className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-ink">
            {g.thread ? `“${g.thread}”` : "A thread"} <span className="text-muted">uses {g.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-muted">
            {grantLeft(g, now)}
            <button onClick={() => onRevoke(g)} className="rounded px-1.5 py-0.5 text-[11px] hover:bg-sunken hover:text-ink">
              Revoke
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Line({ entry, now }: { entry: AuditEntry; now: number }) {
  const small = [auditVia(entry), auditNote(entry)].filter(Boolean).join(" · ");
  const tone = entry.outcome === "denied" || entry.outcome === "error" ? "text-warn" : entry.kind === "keychain" ? "text-muted" : "text-ink";
  return (
    <li className="flex gap-2">
      <span className="w-[74px] shrink-0 text-muted tabular-nums">{when(entry.at, now)}</span>
      <span className={`min-w-0 ${tone}`}>
        {auditSentence(entry)}
        {small && <span className="text-muted"> · {small}</span>}
      </span>
    </li>
  );
}
