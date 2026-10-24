"use client";

// Discounts and refunds in a workspace's admin panel: put a promotion code on the subscription or take it off, and
// refund a charge in full or in part.

import { useState } from "react";
import { day, money, ui } from "./admin-api";
import type { OrgDetail, RunOp } from "./org-types";

function ChargeRow({ charge, run }: { charge: OrgDetail["charges"][number]; run: RunOp }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("requested_by_customer");
  const cents = amount ? Math.round(Number(amount) * 100) : undefined;
  return (
    <tr className="border-t border-admin-border align-middle">
      <td className="py-1.5 pr-2">{day(charge.createdAt)}</td>
      <td className="pr-2">{money(charge.amountCents, charge.currency)}</td>
      <td className="pr-2 text-admin-muted">{charge.refundedCents ? `${money(charge.refundedCents, charge.currency)} back` : charge.status}</td>
      <td className="py-1">
        {charge.refundableCents > 0 && (
          <span className={ui.row}>
            <input className={`${ui.input} w-24`} placeholder={(charge.refundableCents / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Refund amount" />
            <select className={ui.input} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
              <option value="requested_by_customer">asked</option>
              <option value="duplicate">duplicate</option>
              <option value="fraudulent">fraud</option>
            </select>
            <button
              type="button"
              className={ui.danger}
              onClick={() => void run("refund", { chargeId: charge.id, amountCents: cents, reason }, `Refund ${money(cents ?? charge.refundableCents, charge.currency)}?`)}
            >
              {cents ? "Refund part" : "Refund all"}
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

export default function MoneySection({ detail, run }: { detail: OrgDetail; run: RunOp }) {
  const [code, setCode] = useState("");
  const hasSub = Boolean(detail.row?.provider_subscription_id);
  return (
    <section className={ui.card}>
      <h2 className={ui.h}>Discounts and refunds</h2>
      {hasSub && (
        <div className={ui.row}>
          <input className={`${ui.input} w-40`} placeholder="Promotion code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="button" className={ui.btn} disabled={!code} onClick={() => void run("coupon_apply", { code })}>Apply to subscription</button>
          <button type="button" className={ui.btn} onClick={() => void run("coupon_remove", {}, "Take the discount off?")}>Remove discount</button>
        </div>
      )}
      {detail.charges.length ? (
        <table className="w-full text-left text-xs">
          <tbody>
            {detail.charges.map((c) => <ChargeRow key={c.id} charge={c} run={run} />)}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-admin-muted">No charges{detail.row?.provider_customer_id ? "" : ": no Stripe customer"}.</p>
      )}
    </section>
  );
}
