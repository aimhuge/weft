"use client";

// The plan half of a workspace's admin panel: change plan, interval and seats (upgrade, downgrade, switch), cancel at
// period end or resume, downgrade to Free now, re-read from Stripe, comp a $0 plan, or send a checkout link.

import { useState } from "react";
import { ui } from "./admin-api";
import type { OrgDetail, RunOp } from "./org-types";

type Props = { detail: OrgDetail; run: RunOp };

function hasSubscription(row: OrgDetail["row"]): boolean {
  return Boolean(row?.provider_subscription_id) && row?.status !== "canceled";
}

// Plan, interval and seats; with a subscription it's changed in place, without one it becomes a checkout link.
function PlanChange({ detail, run }: Props) {
  const row = detail.row;
  const hasSub = hasSubscription(row);
  const [plan, setPlan] = useState(row?.plan === "team" ? "team" : "pro");
  const [interval, setInterval] = useState(row?.billing_interval === "yearly" ? "yearly" : "monthly");
  const [seats, setSeats] = useState(String(Math.max(row?.seats ?? 1, detail.members.length || 1)));
  const [proration, setProration] = useState("create_prorations");
  const [promo, setPromo] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const change = { plan, interval, seats: Number(seats), proration };
  const makeLink = () => void run("checkout_link", { ...change, promotionCode: promo }).then((a) => setLink((a as { url?: string } | undefined)?.url ?? null));

  return (
    <>
      <div className={ui.row}>
        <select className={ui.input} value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">
          <option value="pro">Pro</option>
          <option value="team">Team</option>
        </select>
        <select className={ui.input} value={interval} onChange={(e) => setInterval(e.target.value)} aria-label="Interval">
          <option value="monthly">monthly</option>
          <option value="yearly">yearly</option>
        </select>
        {plan === "team" && <input className={`${ui.input} w-20`} type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} aria-label="Seats" />}
        {hasSub ? (
          <>
            <select className={ui.input} value={proration} onChange={(e) => setProration(e.target.value)} aria-label="Proration">
              <option value="create_prorations">prorate on next invoice</option>
              <option value="always_invoice">prorate and invoice now</option>
              <option value="none">no proration</option>
            </select>
            <button type="button" className={ui.btn} onClick={() => void run("change_plan", change, `Move ${detail.org.slug} to ${plan} ${interval}?`)}>
              Change subscription
            </button>
          </>
        ) : (
          <>
            <input className={`${ui.input} w-32`} placeholder="Promo code" value={promo} onChange={(e) => setPromo(e.target.value)} aria-label="Promo code" />
            <button type="button" className={ui.btn} onClick={makeLink}>Make checkout link</button>
          </>
        )}
      </div>
      {link && (
        <p className="break-all text-xs">
          Send this to the owner: <a className="text-admin-accent underline" href={link} target="_blank" rel="noreferrer">{link}</a>
        </p>
      )}
    </>
  );
}

function SubscriptionControls({ detail, run }: Props) {
  return (
    <div className={ui.row}>
      {detail.row?.cancel_at_period_end ? (
        <button type="button" className={ui.btn} onClick={() => void run("resume")}>Resume</button>
      ) : (
        <button type="button" className={ui.btn} onClick={() => void run("cancel_at_period_end", {}, "Cancel at the end of the period?")}>Cancel at period end</button>
      )}
      <button type="button" className={ui.danger} onClick={() => void run("downgrade_free", { credit: "none" }, "End the subscription now and move to Free? No credit.")}>
        Downgrade to Free now
      </button>
      <button type="button" className={ui.danger} onClick={() => void run("downgrade_free", { credit: "prorate" }, "End it now and credit the unused time to their Stripe balance?")}>
        …with credit
      </button>
      <button type="button" className={ui.btn} onClick={() => void run("resync")}>Re-read from Stripe</button>
    </div>
  );
}

function CompControls({ detail, run }: Props) {
  const [comp, setComp] = useState("free");
  return (
    <div className={ui.row}>
      <select className={ui.input} value={comp} onChange={(e) => setComp(e.target.value)} aria-label="Comp plan">
        <option value="free">Free</option>
        <option value="oss">Open Source (12 months)</option>
        <option value="edu">Education (12 months)</option>
      </select>
      <button type="button" className={ui.btn} onClick={() => void run("comp", { plan: comp }, `Put ${detail.org.slug} on ${comp}?`)}>Comp plan</button>
    </div>
  );
}

export default function PlanSection({ detail, run }: Props) {
  return (
    <section className={ui.card}>
      <h2 className={ui.h}>Plan</h2>
      <PlanChange detail={detail} run={run} />
      {hasSubscription(detail.row) ? <SubscriptionControls detail={detail} run={run} /> : <CompControls detail={detail} run={run} />}
    </section>
  );
}
