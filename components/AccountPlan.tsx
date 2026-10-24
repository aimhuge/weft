"use client";

import { planCta, useBillingStatus } from "@/lib/use-billing-status";
import { openUpgrade } from "@/lib/use-upgrade";
import Icon, { Spinner } from "./Icon";

// The top of the avatar menu (components/AccountMenu.tsx): your current team, its plan, and one button, Upgrade to
// Pro on a plan without a Puku allowance, which opens the upgrade dialog, and Manage billing on Pro and Team, which
// opens the workspace's billing page.
// Nothing when signed out or when billing can't be read, so the menu never shows an error for a header.
export default function AccountPlan({ onClose }: { onClose: () => void }) {
  const status = useBillingStatus();
  if (status === undefined) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-muted">
        <Spinner size={11} /> Checking your plan
      </div>
    );
  }
  if (status === null || "error" in status) return null;

  const cta = planCta(status.plan.id);
  const open = () => {
    onClose();
    if (cta.upgrade) openUpgrade("plan");
    else if (window.weft) window.weft.openExternal(status.manageUrl);
    else window.open(status.manageUrl, "_blank", "noopener");
  };
  return (
    <div className="mb-1 border-b border-line px-2.5 pb-2.5 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-ink" title={status.org.name}>
          {status.org.name}
        </span>
        <span className="shrink-0 rounded-full border border-line-strong px-2 text-[11px] text-muted">{status.plan.name}</span>
      </div>
      <p className="text-[11.5px] text-muted">
        {status.cancelAtPeriodEnd && status.periodEnd ? `Cancels on ${shortDate(status.periodEnd)}` : "Your current team"}
      </p>
      <button
        role="menuitem"
        onClick={open}
        className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] ${
          cta.upgrade ? "bg-accent font-medium text-on-accent hover:opacity-90" : "border border-line-strong text-ink hover:bg-sunken"
        }`}
      >
        {cta.upgrade && <Icon name="zap" size={13} />}
        {cta.label}
        {!cta.upgrade && " ↗"}
      </button>
    </div>
  );
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
