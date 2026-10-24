"use client";

// The plan half of a workspace's admin panel: change plan, interval and seats (upgrade, downgrade, switch), cancel at
// period end or resume, downgrade to Free now, re-read from Stripe, comp a $0 plan, or send a checkout link.

import { useState } from "react";
import { Button, Field, Input, Section, Select } from "@/components/admin/kit";
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
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Plan">
          <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="pro">Pro</option>
            <option value="team">Team</option>
          </Select>
        </Field>
        <Field label="Interval">
          <Select value={interval} onChange={(e) => setInterval(e.target.value)}>
            <option value="monthly">monthly</option>
            <option value="yearly">yearly</option>
          </Select>
        </Field>
        {plan === "team" && (
          <Field label="Seats">
            <Input className="w-20" type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
          </Field>
        )}
        {hasSub ? (
          <>
            <Field label="Proration">
              <Select value={proration} onChange={(e) => setProration(e.target.value)}>
                <option value="create_prorations">prorate on next invoice</option>
                <option value="always_invoice">prorate and invoice now</option>
                <option value="none">no proration</option>
              </Select>
            </Field>
            <Button variant="primary" onClick={() => void run("change_plan", change, `Move ${detail.org.slug} to ${plan} ${interval}?`)}>
              Change subscription
            </Button>
          </>
        ) : (
          <>
            <Field label="Promo code">
              <Input className="w-32" placeholder="Promo code" value={promo} onChange={(e) => setPromo(e.target.value)} />
            </Field>
            <Button variant="primary" onClick={makeLink}>
              Make checkout link
            </Button>
          </>
        )}
      </div>
      {link && (
        <p className="break-all text-[12.5px] text-muted">
          Send this to the owner:{" "}
          <a className="text-accent underline" href={link} target="_blank" rel="noreferrer">
            {link}
          </a>
        </p>
      )}
    </>
  );
}

function SubscriptionControls({ detail, run }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {detail.row?.cancel_at_period_end ? (
        <Button onClick={() => void run("resume")}>Resume</Button>
      ) : (
        <Button onClick={() => void run("cancel_at_period_end", {}, "Cancel at the end of the period?")}>Cancel at period end</Button>
      )}
      <Button variant="danger" onClick={() => void run("downgrade_free", { credit: "none" }, "End the subscription now and move to Free? No credit.")}>
        Downgrade to Free now
      </Button>
      <Button
        variant="danger"
        onClick={() => void run("downgrade_free", { credit: "prorate" }, "End it now and credit the unused time to their Stripe balance?")}
      >
        …with credit
      </Button>
      <Button onClick={() => void run("resync")}>Re-read from Stripe</Button>
    </div>
  );
}

function CompControls({ detail, run }: Props) {
  const [comp, setComp] = useState("free");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Comp plan">
        <Select value={comp} onChange={(e) => setComp(e.target.value)}>
          <option value="free">Free</option>
          <option value="oss">Open Source (12 months)</option>
          <option value="edu">Education (12 months)</option>
        </Select>
      </Field>
      <Button variant="primary" onClick={() => void run("comp", { plan: comp }, `Put ${detail.org.slug} on ${comp}?`)}>
        Comp plan
      </Button>
    </div>
  );
}

export default function PlanSection({ detail, run }: Props) {
  return (
    <Section title="Plan" note="Change plan, interval and seats for this workspace.">
      <PlanChange detail={detail} run={run} />
      {hasSubscription(detail.row) ? <SubscriptionControls detail={detail} run={run} /> : <CompControls detail={detail} run={run} />}
    </Section>
  );
}
