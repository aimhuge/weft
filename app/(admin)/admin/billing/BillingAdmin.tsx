"use client";

// The client half of /admin/billing: a searchable workspace list on the left, the chosen workspace's panel on the right.
// Built on the admin kit (components/admin), so it matches the board's tokens in light and dark.

import { useEffect, useState } from "react";
import { AdminPage, Badge, Empty, Input, Notice } from "@/components/admin/kit";
import { adminGet } from "../admin-api";
import OrgPanel from "./OrgPanel";

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  seats: number;
  hasStripeIds: boolean;
}

interface ListAnswer {
  orgs: OrgRow[];
  keys: string[];
  defaultMode: string | null;
}

// Free and comped plans read as plain; anything paid gets the accent pill.
const FREE_PLANS = new Set(["free", "oss", "edu"]);

function planTone(plan: string): "accent" | "neutral" {
  return FREE_PLANS.has(plan) ? "neutral" : "accent";
}

export default function BillingAdmin() {
  const [q, setQ] = useState("");
  const [list, setList] = useState<ListAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      adminGet<ListAnswer>(`/api/admin/billing?q=${encodeURIComponent(q)}`)
        .then((a) => {
          if (!live) return;
          setList(a);
          setError(null);
        })
        .catch((e: unknown) => {
          if (live) setError(e instanceof Error ? e.message : String(e));
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, tick]);

  const stripeKeys = list?.keys.length ? list.keys.join(" + ") : "none";
  const subtitle = `Stripe keys: ${stripeKeys}${list?.defaultMode ? ` · this Weft sells in ${list.defaultMode} mode` : ""}`;

  return (
    <AdminPage title="Billing" wide subtitle={subtitle}>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid items-start gap-4 md:grid-cols-[260px_1fr]">
        <aside className="sticky top-[52px] flex flex-col gap-2 rounded-xl border border-line bg-panel p-3">
          <Input placeholder="Search workspaces" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto">
            {list?.orgs.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setPicked(o.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-sunken ${picked === o.id ? "bg-accent-soft text-accent" : ""}`}
                >
                  <span className="truncate">{o.slug}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {o.hasStripeIds && (
                      <span title="Has Stripe ids" className="text-[11px] text-muted">
                        $
                      </span>
                    )}
                    <Badge tone={planTone(o.plan)}>{o.plan}</Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        {picked ? <OrgPanel key={picked} orgId={picked} onChanged={() => setTick((t) => t + 1)} /> : <Empty>Pick a workspace on the left.</Empty>}
      </div>
    </AdminPage>
  );
}
