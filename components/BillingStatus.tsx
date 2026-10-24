"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCompact, type MeterBalance } from "@aimhuge/billing";
import { freeTierCapLabel } from "@/lib/billing/plans";
import { api, type BillingClientView, type BillingStatusView } from "@/lib/client";
import { planCta } from "@/lib/use-billing-status";
import { openUpgrade } from "@/lib/use-upgrade";
import CrashGuard from "./CrashGuard";
import { Spinner } from "./Icon";

// The Settings → Weft account section's plan row (docs/architecture/billing.md). Renders nothing when signed
// out (the route returns null), a one-line error otherwise, and a "Plan: <name>" + a thin usage bar + a single
// button for the manage page. Refetches on window focus, so coming back from Checkout updates it.

function formatReset(periodEnd: string | null): string {
  if (!periodEnd) return "";
  const end = new Date(periodEnd);
  if (Number.isNaN(end.getTime())) return "";
  return end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function PukuBar({ puku }: { puku: MeterBalance }) {
  // allowance + granted is the total this window. Spent is what they've used.
  const total = puku.allowance + puku.granted;
  const used = puku.spent;
  const fraction = total > 0 ? Math.min(1, used / total) : 0;
  const reset = formatReset(puku.window.end);
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken">
        <span className="block h-full bg-accent" style={{ width: `${fraction * 100}%` }} />
      </span>
      <span className="text-[12px] text-muted">
        {formatCompact(used)} of {formatCompact(total)} tokens
        {reset ? ` · resets ${reset}` : ""}
      </span>
    </span>
  );
}

export default function BillingStatus() {
  const [status, setStatus] = useState<BillingClientView | undefined>(undefined);

  const load = useCallback(() => {
    api
      .billingStatus()
      .then((d) => setStatus(d))
      .catch(() => setStatus({ error: "Couldn't load billing." }));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  // Signed out (null) — hide. Loading on the first fetch — show a quiet spinner.
  if (status === undefined) {
    return (
      <span className="flex items-center gap-2 text-[12.5px] text-muted">
        <Spinner size={11} /> Checking your plan
      </span>
    );
  }
  if (status === null) return null;
  if ("error" in status) return <p className="break-words text-[12.5px] text-muted">{status.error}</p>;

  const s: BillingStatusView = status;

  const cta = planCta(s.plan.id);
  // Upgrade opens the in-app pricing dialog; Manage billing opens the workspace's billing page on weft.zip.
  function openManage() {
    if (cta.upgrade) openUpgrade("plan");
    else if (window.weft) window.weft.openExternal(s.manageUrl);
  }

  return (
    <CrashGuard what="billing" name={s.plan.name} inline>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <span className="text-ink">
          Plan: <span className="font-medium">{s.plan.name}</span>
          <span className="text-muted"> · {s.org.name}</span>
        </span>
        {s.puku ? (
          <PukuBar puku={s.puku} />
        ) : (
          <span className="text-[12px] text-muted">Puku trial: {freeTierCapLabel()}</span>
        )}
        {s.cancelAtPeriodEnd && s.periodEnd && (
          <span className="text-[12px] text-warn">Cancels on {formatReset(s.periodEnd)}</span>
        )}
        <button
          onClick={openManage}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken"
        >
          {cta.label}
          {!cta.upgrade && " ↗"}
        </button>
      </span>
    </CrashGuard>
  );
}
