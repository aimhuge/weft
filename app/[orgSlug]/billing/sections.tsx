// Presentational pieces of the /[orgSlug]/billing page (docs/architecture/billing.md). The page in
// page.tsx keeps the gate, the reconcile, the parallel reads and the action binds; each component
// here takes plain props (no data fetching) so its complexity stays low. CSS classes, copy and
// conditional structure are unchanged from when the page rendered them inline.
import { formatCompact, formatMoney } from "@aimhuge/billing";
import { ScanCode } from "@/components/team/ScanCode";
import { appShareLabel, freeTierCapLabel } from "@/lib/billing/plans";

// Notices renders the stack of small messages above the main sections. Each notice pushes its own
// conditional down here, so the page doesn't accumulate a long if/then chain just to label Stripe
// and the role gate.
export function Notices({
  actionError,
  configured,
  live,
  canManage,
}: {
  actionError: string | null;
  configured: boolean;
  live: boolean;
  canManage: boolean;
}) {
  return (
    <>
      {actionError ? (
        <section className="wz-billingSection">
          <div className="wz-billingNotice" role="alert">{actionError}</div>
        </section>
      ) : null}

      {!configured ? (
        <section className="wz-billingSection">
          <div className="wz-billingNotice">
            Billing isn&apos;t set up on this Weft yet. The plan below is read-only; an owner can&apos;t upgrade until Stripe is wired.
          </div>
        </section>
      ) : null}

      {!live ? (
        <section className="wz-billingSection">
          <div className="wz-billingNotice wz-billingNoticeMuted">Test mode: no real money moves.</div>
        </section>
      ) : null}

      {!canManage ? (
        <section className="wz-billingSection">
          <div className="wz-billingNotice wz-billingNoticeMuted">Ask an owner to change the plan.</div>
        </section>
      ) : null}
    </>
  );
}

// PlanSection renders the current-plan card. The renewal line and the cancel-at-period-end
// notice each gate on the same `isPaid` / `cancelAtPeriodEnd` flags the page already computed.
// `isPaid` is "any plan above Free", so a Team workspace reads as paid too, not as a downgrade.
export function PlanSection({
  plan,
  sub,
  isPaid,
  canManage,
  resumeAction,
}: {
  plan: { id: string; name: string };
  sub: {
    status: string;
    interval: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  };
  isPaid: boolean;
  canManage: boolean;
  resumeAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="wz-billingSection">
      <h2 className="wz-billingSectionTitle">Current plan</h2>
      <div className="wz-billingPlanCard">
        <div className="wz-billingPlanHead">
          <div className="wz-billingPlanName">{plan.name}</div>
          <div className={`wz-billingPlanStatus wz-billingPlanStatus-${sub.status}`}>{sub.status}</div>
        </div>
        {isPaid ? (
          <div className="wz-billingPlanMeta">
            {sub.interval === "yearly" ? "Yearly" : "Monthly"} · renews {new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </div>
        ) : (
          <div className="wz-billingPlanMeta">Today&apos;s trial: a daily Puku cap on the deployed Weft.</div>
        )}
        <div className="wz-billingPlanMeta">{appShareLabel(plan.id)}.</div>
        {isPaid && sub.cancelAtPeriodEnd ? (
          <div className="wz-billingCancelNotice">
            <span>
              Cancels on {new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} — access continues until then.
            </span>
            {canManage ? (
              <form action={resumeAction}>
                <button type="submit" className="wz-billingButton wz-billingButtonGhost">Resume</button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// UsageSection renders the Puku usage block. When the workspace has no Puku allowance the bar is
// swapped for the daily-trial muted hint the page used to show inline.
export function UsageSection({
  puku,
}: {
  puku: { spent: number; allowance: number; remaining: number } | null;
}) {
  return (
    <section className="wz-billingSection">
      <h2 className="wz-billingSectionTitle">Puku usage</h2>
      {puku ? (
        <div className="wz-billingUsage">
          <div className="wz-billingUsageText">
            <strong>{formatTokens(puku.spent)}</strong> of <strong>{formatTokens(puku.allowance)}</strong> tokens this period
          </div>
          <UsageBar used={puku.spent} allowance={puku.allowance} />
          <div className="wz-billingUsageMeta">
            {puku.remaining > 0
              ? `${formatTokens(puku.remaining)} tokens left`
              : "Allowance used — resets at the start of your next billing period."}
          </div>
        </div>
      ) : (
        <div className="wz-billingUsage wz-billingUsageMuted">
          Puku trial: {freeTierCapLabel()} on Weft&apos;s key. Upgrade to Pro for a monthly allowance.
        </div>
      )}
    </section>
  );
}

// UpgradeSection renders the Free→Pro pitch and its two forms. The forms are only shown to managers
// (a member still sees the prices and the blurb, so the upgrade value is visible).
export function UpgradeSection({
  blurb,
  monthlyLabel,
  yearlyLabel,
  canManage,
  hostedCheckout,
  upgradeMonthly,
  upgradeYearly,
}: {
  blurb: string;
  monthlyLabel: string;
  yearlyLabel: string;
  canManage: boolean;
  hostedCheckout: boolean;
  upgradeMonthly: (formData: FormData) => Promise<void>;
  upgradeYearly: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="wz-billingSection">
      <h2 className="wz-billingSectionTitle">Upgrade to Pro</h2>
      <div className="wz-billingProCard">
        <div className="wz-billingProBlurb">{blurb}</div>
        <div className="wz-billingPlanMeta">{appShareLabel("pro")}.</div>
        <div className="wz-billingProPrice">
          <div className="wz-billingProPriceRow">
            <div className="wz-billingProPriceLabel">Monthly</div>
            <div className="wz-billingProPriceValue">{monthlyLabel}<span className="wz-billingProPriceCadence">/month</span></div>
          </div>
          <div className="wz-billingProPriceRow">
            <div className="wz-billingProPriceLabel">Yearly</div>
            <div className="wz-billingProPriceValue">{yearlyLabel}<span className="wz-billingProPriceCadence">/year</span></div>
            <div className="wz-billingProPriceSavings">two months free</div>
          </div>
        </div>
        {canManage ? (
          <div className="wz-billingProActions">
            <form action={upgradeMonthly}>
              <button type="submit" className="wz-billingButton wz-billingButtonPrimary" disabled={!hostedCheckout}>
                Upgrade monthly
              </button>
            </form>
            <form action={upgradeYearly}>
              <button type="submit" className="wz-billingButton wz-billingButtonPrimary" disabled={!hostedCheckout}>
                Upgrade yearly
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ManageSection renders the Stripe-portal and cancel-at-period-end controls. Visible only on Pro and
// only to managers; a member on a paid org gets a different page surface (the read-only notices).
export function ManageSection({
  cancelAtPeriodEnd,
  manageAction,
  cancelAction,
}: {
  cancelAtPeriodEnd: boolean;
  manageAction: (formData: FormData) => Promise<void>;
  cancelAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="wz-billingSection">
      <h2 className="wz-billingSectionTitle">Manage billing</h2>
      <p className="wz-billingSub">Update your payment method, change the billing email, or download past invoices through Stripe&apos;s customer portal.</p>
      <div className="wz-billingProActions">
        <form action={manageAction}>
          <button type="submit" className="wz-billingButton">Open billing portal</button>
        </form>
        {!cancelAtPeriodEnd ? (
          <form action={cancelAction}>
            <button type="submit" className="wz-billingButton wz-billingButtonDanger">Cancel at period end</button>
          </form>
        ) : null}
      </div>
    </section>
  );
}

// InvoicesSection renders the last few invoices. The package's `formatMoney` gives us the canonical
// money string; dates are formatted in the user's locale.
export function InvoicesSection({
  orgSlug,
  invoices,
}: {
  orgSlug: string;
  invoices: { id: string; number: string; issuedAt: string; totalCents: number; currency: string; status: string }[];
}) {
  return (
    <section className="wz-billingSection">
      <h2 className="wz-billingSectionTitle">Invoices</h2>
      {invoices.length === 0 ? (
        <p className="wz-billingSub">No invoices yet.</p>
      ) : (
        <ol className="wz-invoices">
          {invoices.map((inv) => (
            <InvoiceTicket key={inv.id} orgSlug={orgSlug} inv={inv} />
          ))}
        </ol>
      )}
    </section>
  );
}

// Formats a number of tokens as "3.2M" / "120K" / "4,200". formatCompact handles 1K/1M rounding; below
// 1000 we fall back to a plain integer so a small allowance is exact.
function formatTokens(n: number): string {
  if (n >= 1000) return formatCompact(n);
  return n.toLocaleString("en-US");
}

// Renders the bar as inline elements (track + fill) with a width based on used/allowance. Width is
// floored at 0 and capped at 100% so a stale ledger can't blow up the layout. Free (no allowance) is
// handled by the caller — this is only called when an allowance exists.
function UsageBar({ used, allowance }: { used: number; allowance: number }) {
  const pct = allowance > 0 ? Math.min(100, Math.max(0, (used / allowance) * 100)) : 0;
  return (
    <div className="wz-billingUsageBar" role="progressbar" aria-valuemin={0} aria-valuemax={allowance} aria-valuenow={used}>
      <div className="wz-billingUsageBarFill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// One invoice as a ticket, linked to its full sheet: number and date on the left, the amount large, its status as a glowing chip,
// and a scan stripe on the stub. The package's formatMoney gives us the canonical money string.
function InvoiceTicket({ orgSlug, inv }: { orgSlug: string; inv: { number: string; issuedAt: string; totalCents: number; currency: string; status: string } }) {
  return (
    <li className={`wz-invoice wz-invoice-${inv.status}`}>
      <div className="wz-invoiceMain">
        <a className="wz-invoiceNo" href={`/${orgSlug}/billing/invoices/${encodeURIComponent(inv.number)}`}>
          {inv.number}
        </a>
        <span className="wz-invoiceDate">
          {new Date(inv.issuedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
        </span>
      </div>
      <div className="wz-invoiceAmount">{formatMoney(inv.totalCents, inv.currency)}</div>
      <div className="wz-invoiceStub">
        <span className={`wz-billingInvoiceStatus wz-billingInvoiceStatus-${inv.status}`}>{inv.status}</span>
        <ScanCode seed={inv.number} />
      </div>
    </li>
  );
}
