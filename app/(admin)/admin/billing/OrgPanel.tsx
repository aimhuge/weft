"use client";

// One workspace in /admin/billing: its plan and which Stripe mode its ids live in up top, then the sections that change
// it, then its invoices and audit log. Every change asks first when it moves money, then reloads the panel.

import { useCallback, useEffect, useState } from "react";
import { adminGet, adminPost, day, money, ui } from "./admin-api";
import MoneySection from "./MoneySection";
import type { OrgDetail, RunOp } from "./org-types";
import PeopleSection from "./PeopleSection";
import PlanSection from "./PlanSection";
import ResetSection from "./ResetSection";

const MODE_BADGE: Record<string, string> = {
  live: "bg-green-500/15 text-green-700",
  test: "bg-amber-500/20 text-amber-700",
  unknown: "bg-red-500/15 text-red-700",
  none: "bg-black/5 text-admin-muted",
};

// The row in one line: plan · status · interval · seats · price · renews or cancels on.
function summary(row: OrgDetail["row"]): string {
  if (!row) return "free · no subscription row";
  const seats = `${row.seats} seat${row.seats > 1 ? "s" : ""}`;
  const end = `${row.cancel_at_period_end ? "cancels" : "renews"} ${day(row.current_period_end)}`;
  return [row.plan, row.status, row.billing_interval, seats, money(row.unit_amount_cents), end].join(" · ");
}

function ids(detail: OrgDetail): string {
  const row = detail.row;
  const parts = [row?.provider ?? "mock", row?.provider_customer_id ?? "no customer", row?.provider_subscription_id ?? "no subscription"];
  if (detail.mode.detail) parts.push(detail.mode.detail);
  return parts.join(" · ");
}

function ModeBadge({ mode }: { mode: OrgDetail["mode"] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${MODE_BADGE[mode.mode] ?? ""}`} title={mode.detail ?? ""}>
      {mode.mode === "none" ? "no Stripe ids" : `${mode.mode} mode`}
      {mode.deleted ? " · deleted" : ""}
    </span>
  );
}

function Header({ detail }: { detail: OrgDetail }) {
  return (
    <section className={ui.card}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-semibold">{detail.org.name}</h2>
        <span className="font-mono text-xs text-admin-muted">{detail.org.slug}</span>
        <ModeBadge mode={detail.mode} />
      </div>
      <p className="text-sm">{summary(detail.row)}</p>
      <p className="font-mono text-[11px] text-admin-muted">{ids(detail)}</p>
      {detail.referral && <p className="text-xs">Referral code <span className="font-mono">{detail.referral.code}</span></p>}
      {detail.errors.map((e) => <p key={e} className="text-xs text-red-600">{e}</p>)}
    </section>
  );
}

function History({ detail }: { detail: OrgDetail }) {
  return (
    <section className={ui.card}>
      <h2 className={ui.h}>Invoices</h2>
      {detail.invoices.length ? (
        <ul className="text-xs">
          {detail.invoices.map((i) => (
            <li key={i.number}>
              <span className="font-mono">{i.number}</span> · {i.status} · {money(i.total_cents)} · {day(i.issued_at)} · {i.provider}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-admin-muted">None mirrored.</p>}
      <h2 className={ui.h}>Billing events</h2>
      <ul className="flex flex-col gap-0.5 text-xs">
        {detail.events.map((e, n) => (
          <li key={`${e.created_at}-${n}`} title={JSON.stringify(e.payload)}>
            <span className="text-admin-muted">{day(e.created_at)}</span> <span className="font-mono">{e.kind}</span> {e.actor_email ?? ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function OrgPanel({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/api/admin/billing/${orgId}`;

  const load = useCallback(() => {
    adminGet<OrgDetail>(path)
      .then(setDetail)
      .catch((e: unknown) => setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  }, [path]);
  useEffect(load, [load]);

  const run: RunOp = async (op, payload = {}, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return undefined;
    setBusy(true);
    try {
      const answer = await adminPost(path, { op, ...payload });
      setNote({ ok: true, text: `${op} done` });
      onChanged();
      return answer;
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return undefined;
    } finally {
      setBusy(false);
      load();
    }
  };

  if (!detail) return <p className="text-sm text-admin-muted">{note?.text ?? "Loading…"}</p>;
  return (
    <div className={`flex flex-col gap-3 ${busy ? "pointer-events-none opacity-60" : ""}`}>
      <Header detail={detail} />
      {note && <p className={`text-sm ${note.ok ? "text-green-700" : "text-red-600"}`}>{note.text}</p>}
      <PlanSection detail={detail} run={run} />
      <MoneySection detail={detail} run={run} />
      <PeopleSection detail={detail} run={run} />
      <ResetSection detail={detail} run={run} />
      <History detail={detail} />
    </div>
  );
}
