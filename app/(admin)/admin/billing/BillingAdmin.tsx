"use client";

// The client half of /admin/billing: a searchable workspace list on the left, the chosen workspace's panel on the right.

import { useEffect, useState } from "react";
import { adminGet, ui } from "./admin-api";
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6 text-admin-text">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <span className="text-xs text-admin-muted">
          Stripe keys: {list?.keys.length ? list.keys.join(" + ") : "none"}
          {list?.defaultMode ? ` · this Weft sells in ${list.defaultMode} mode` : ""}
        </span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-2">
          <input className={ui.input} placeholder="Search workspaces" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="flex flex-col gap-1">
            {list?.orgs.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setPicked(o.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-black/5 ${picked === o.id ? "bg-black/5" : ""}`}
                >
                  <span className="truncate">{o.slug}</span>
                  <span className="flex items-center gap-1 text-[11px] text-admin-muted">
                    {o.hasStripeIds && <span title="Has Stripe ids">$</span>}
                    {o.plan}
                    {o.seats > 1 ? `×${o.seats}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {picked ? <OrgPanel key={picked} orgId={picked} onChanged={() => setTick((t) => t + 1)} /> : <p className="text-sm text-admin-muted">Pick a workspace.</p>}
      </div>
    </div>
  );
}
