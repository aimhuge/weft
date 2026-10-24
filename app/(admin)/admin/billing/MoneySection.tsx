"use client";

// Discounts and refunds in a workspace's admin panel: put a promotion code on the subscription or take it off, and
// refund a charge in full or in part.

import { useState } from "react";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Button, Field, Input, Section, Select } from "@/components/admin/kit";
import { day, money } from "../admin-api";
import type { OrgDetail, RunOp } from "./org-types";

type Charge = OrgDetail["charges"][number];

// One charge with the refund form: an amount, a reason, and the button that moves the money.
function ChargeCell({ charge, run }: { charge: Charge; run: RunOp }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("requested_by_customer");
  const cents = amount ? Math.round(Number(amount) * 100) : undefined;
  if (charge.refundableCents <= 0) return <span className="text-faint">—</span>;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Amount">
        <Input
          className="w-24"
          placeholder={(charge.refundableCents / 100).toFixed(2)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label="Reason">
        <Select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="requested_by_customer">asked</option>
          <option value="duplicate">duplicate</option>
          <option value="fraudulent">fraud</option>
        </Select>
      </Field>
      <Button
        variant="danger"
        onClick={() => void run("refund", { chargeId: charge.id, amountCents: cents, reason }, `Refund ${money(cents ?? charge.refundableCents, charge.currency)}?`)}
      >
        {cents ? "Refund part" : "Refund all"}
      </Button>
    </div>
  );
}

// The refund form needs the runner, so the columns are built per render.
function chargeColumns(run: RunOp): Column<Charge>[] {
  return [
    { key: "date", header: "Date", cell: (c) => day(c.createdAt), className: "whitespace-nowrap" },
    { key: "amount", header: "Amount", cell: (c) => money(c.amountCents, c.currency), className: "whitespace-nowrap" },
    {
      key: "state",
      header: "State",
      cell: (c) => <span className="text-muted">{c.refundedCents ? `${money(c.refundedCents, c.currency)} back` : c.status}</span>,
    },
    { key: "refund", header: "Refund", cell: (c) => <ChargeCell charge={c} run={run} /> },
  ];
}

export default function MoneySection({ detail, run }: { detail: OrgDetail; run: RunOp }) {
  const [code, setCode] = useState("");
  const hasSub = Boolean(detail.row?.provider_subscription_id);
  const empty = detail.row?.provider_customer_id ? "No charges." : "No charges: no Stripe customer.";
  return (
    <Section title="Discounts and refunds" note="Put a promotion code on the subscription, or refund a charge.">
      {hasSub && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Promotion code">
            <Input className="w-40" placeholder="Promotion code" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button variant="primary" disabled={!code} onClick={() => void run("coupon_apply", { code })}>
            Apply to subscription
          </Button>
          <Button onClick={() => void run("coupon_remove", {}, "Take the discount off?")}>Remove discount</Button>
        </div>
      )}
      <DataTable columns={chargeColumns(run)} rows={detail.charges} rowKey={(c) => c.id} empty={empty} />
    </Section>
  );
}
