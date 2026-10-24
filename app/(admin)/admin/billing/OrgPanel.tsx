"use client";

// One workspace in /admin/billing: its plan and which Stripe mode its ids live in up top, then the sections that change
// it, then its invoices and audit log. Every change asks first when it moves money, then reloads the panel.

import { useCallback, useEffect, useState } from "react";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Badge, KeyValues, Notice, Section } from "@/components/admin/kit";
import { adminGet, adminPost, day, money } from "../admin-api";
import MoneySection from "./MoneySection";
import type { OrgDetail, RunOp } from "./org-types";
import PeopleSection from "./PeopleSection";
import PlanSection from "./PlanSection";
import ResetSection from "./ResetSection";

const MODE_TONE: Record<OrgDetail["mode"]["mode"], "ok" | "warn" | "danger" | "neutral"> = {
  live: "ok",
  test: "warn",
  unknown: "danger",
  none: "neutral",
};

// The row in one line: plan · status · interval · seats · price · renews or cancels on.
function summary(row: OrgDetail["row"]): string {
  if (!row) return "free · no subscription row";
  const seats = `${row.seats} seat${row.seats > 1 ? "s" : ""}`;
  const end = `${row.cancel_at_period_end ? "cancels" : "renews"} ${day(row.current_period_end)}`;
  return [row.plan, row.status, row.billing_interval, seats, money(row.unit_amount_cents), end].join(" · ");
}

function ModeBadge({ mode }: { mode: OrgDetail["mode"] }) {
  return (
    <Badge tone={MODE_TONE[mode.mode]} title={mode.detail ?? ""}>
      {mode.mode === "none" ? "no Stripe ids" : `${mode.mode} mode`}
      {mode.deleted ? " · deleted" : ""}
    </Badge>
  );
}

function Header({ detail }: { detail: OrgDetail }) {
  const row = detail.row;
  return (
    <Section
      title={detail.org.name}
      note={summary(detail.row)}
      actions={<ModeBadge mode={detail.mode} />}
    >
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[12px] text-muted">{detail.org.slug}</span>
        <KeyValues
          rows={[
            ["Provider", row?.provider ?? "mock"],
            ["Customer", row?.provider_customer_id ?? "no customer"],
            ["Subscription", row?.provider_subscription_id ?? "no subscription"],
          ]}
        />
        {detail.referral && (
          <p className="text-[12.5px] text-muted">
            Referral code <span className="font-mono text-ink">{detail.referral.code}</span>
          </p>
        )}
        {detail.mode.detail && <p className="font-mono text-[11px] text-faint">{detail.mode.detail}</p>}
        {detail.errors.map((e) => (
          <Notice key={e} tone="danger">
            {e}
          </Notice>
        ))}
      </div>
    </Section>
  );
}

const invoiceColumns: Column<OrgDetail["invoices"][number]>[] = [
  { key: "number", header: "Number", cell: (i) => <span className="font-mono">{i.number}</span> },
  { key: "status", header: "Status", cell: (i) => i.status },
  { key: "total", header: "Total", cell: (i) => money(i.total_cents), className: "whitespace-nowrap" },
  { key: "issued", header: "Issued", cell: (i) => day(i.issued_at), className: "whitespace-nowrap" },
  { key: "provider", header: "Provider", cell: (i) => <span className="text-muted">{i.provider}</span> },
];

const eventColumns: Column<OrgDetail["events"][number]>[] = [
  { key: "date", header: "Date", cell: (e) => day(e.created_at), className: "whitespace-nowrap" },
  { key: "kind", header: "Kind", cell: (e) => <span className="font-mono">{e.kind}</span> },
  { key: "actor", header: "Actor", cell: (e) => <span className="text-muted">{e.actor_email ?? "—"}</span> },
];

function History({ detail }: { detail: OrgDetail }) {
  return (
    <Section title="Invoices">
      <DataTable
        columns={invoiceColumns}
        rows={detail.invoices}
        rowKey={(i) => i.number}
        empty="None mirrored."
      />
      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Billing events</h3>
        <DataTable
          columns={eventColumns}
          rows={detail.events}
          rowKey={(e) => `${e.created_at}-${e.kind}-${e.actor_email ?? ""}`}
          empty="No billing events yet."
        />
      </div>
    </Section>
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

  if (!detail) return <p className="text-[13px] text-muted">{note?.text ?? "Loading…"}</p>;
  return (
    <div className={`flex flex-col gap-3 ${busy ? "pointer-events-none opacity-60" : ""}`}>
      <Header detail={detail} />
      {note && <Notice tone={note.ok ? "ok" : "danger"}>{note.text}</Notice>}
      <PlanSection detail={detail} run={run} />
      <MoneySection detail={detail} run={run} />
      <PeopleSection detail={detail} run={run} />
      <ResetSection detail={detail} run={run} />
      <History detail={detail} />
    </div>
  );
}
