// The /[orgSlug]/billing page on weft.zip (docs/architecture/billing.md): the workspace's plan, its Puku
// allowance, the upgrade or manage-billing controls, and the last few invoices. The data is read through
// `billing.subscription` + `billing.balance` + `billing.account`; mutations go through lib/billing-actions.
//
// Returning from Checkout (?checkout=done) is reconciled before the page reads so the UI updates before
// the webhook lands. Swallow the error: the webhook is the authority, and a failed reconcile just means
// the next read will lag by a few seconds.
//
// Members see the same page read-only with an "Ask an owner to change the plan" hint. Owners and admins
// see the upgrade / manage / cancel / resume controls. The role gate uses `workspace.manage` from
// @aimhuge/teams — billing is workspace management, not member management.
//
// Wrapped in <Suspense> (cacheComponents): the page reads cookies through the gate, and a cookies() call
// outside a Suspense boundary blocks the route from prerendering. The layout is already wrapped, so this
// is belt-and-braces; matching the team page's wrapper keeps the codebase uniform.
import type { Metadata } from "next";
import { Suspense } from "react";
import { roleCan, roleLabel } from "@aimhuge/teams";
import { formatMoney } from "@aimhuge/billing";
import { isDeployed } from "@/lib/home";
import { requireTeam } from "@/lib/teams";
import { billing, billingConfigured, billingService } from "@/lib/billing/billing";
import { catalog, PUKU_METER } from "@/lib/billing/plans";
import { isPaid } from "@/lib/billing/plan-gate";
import { cancelForm, manageForm, resumeForm, upgradeForm } from "@/lib/billing-actions";
import {
  InvoicesSection,
  ManageSection,
  Notices,
  PlanSection,
  UpgradeSection,
  UsageSection,
} from "./sections";

export const metadata: Metadata = {
  title: "Billing",
  description: "Your Weft workspace's plan, Puku allowance and invoices.",
};

function NotDeployedCard({ slug }: { slug: string }) {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Billing · {slug}</h1>
        <p className="wz-authSub">Workspaces live on weft.zip. In the desktop app, the board&apos;s account button is the way in.</p>
      </main>
    </div>
  );
}

// The page body, kept as a plain async function so the gate, the reconcile and the renders can be
// linear. It reads the query inside the Suspense wrapper, since under cacheComponents a searchParams read outside one
// blocks the route: ?checkout=done after Stripe Checkout, ?error=… from a refused action.
type Query = Record<string, string | string[] | undefined>;
async function readQuery(searchParams?: Promise<Query>) {
  const query = searchParams ? await searchParams : {};
  return { checkoutDone: query.checkout === "done", actionError: typeof query.error === "string" ? query.error : null };
}

async function BillingPageBody({ orgSlug, searchParams }: { orgSlug: string; searchParams?: Promise<Query> }) {
  const { checkoutDone, actionError } = await readQuery(searchParams);
  const ctx = await requireTeam(orgSlug, `/${orgSlug}/billing`);
  const canManage = roleCan(ctx.role, "workspace.manage");
  const configured = billingConfigured();
  const service = billingService();
  const provider = billing.provider();

  // No billing service: this Weft is local without a Stripe key. Show a minimal page. Checked
  // before the reconcile so a non-deployed run short-circuits cleanly.
  if (!service) {
    return <NotConfiguredPage />;
  }

  // Returning from Checkout: re-read upstream so the page updates before the webhook lands. The
  // webhook is the authority; a failed reconcile just means a slightly older read.
  if (checkoutDone) {
    try {
      await provider.reconcile({ service, orgId: ctx.org.id, orgSlug: ctx.org.slug, actorEmail: ctx.user.email });
    } catch (err) {
      console.error(`Billing reconcile: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  // Sub + plan + balance + invoices in parallel. account() also pulls payment methods and the billing
  // profile, so it only runs on a paid plan.
  const sub = await billing.subscription(service, ctx.org.id);
  const plan = catalog.get(sub.plan);
  const isPaidPlan = isPaid(plan.id);
  const hasPukuAllowance = catalog.allowance(plan.id, PUKU_METER) !== null;
  const [puku, account] = await Promise.all([
    hasPukuAllowance ? billing.balance(service, ctx.org.id, PUKU_METER).catch(() => null) : Promise.resolve(null),
    isPaidPlan ? billing.account(service, ctx.org.id).catch(() => null) : Promise.resolve(null),
  ]);

  // Pro plan prices. The catalog is the source of truth — never re-price in this file.
  const monthlyCents = catalog.priceCents("pro", "monthly");
  const yearlyCents = catalog.totalCents("pro", "yearly", 1);
  const monthlyLabel = formatMoney(monthlyCents);
  const yearlyLabel = formatMoney(yearlyCents);

  // Bind the server actions with the slug (and the interval for upgrade). Server actions can be bound
  // in server components — the bound function still serializes correctly when handed to <form action>.
  const upgradeMonthly = upgradeForm.bind(null, orgSlug, "monthly");
  const upgradeYearly = upgradeForm.bind(null, orgSlug, "yearly");
  const manageAction = manageForm.bind(null, orgSlug);
  const cancelAction = cancelForm.bind(null, orgSlug);
  const resumeAction = resumeForm.bind(null, orgSlug);

  return (
    <div className="wz-billingPage">
      <header className="wz-billingHeader wz-hero wz-heroCanyon">
        <h1 className="wz-billingTitle">Billing</h1>
        <p className="wz-billingSub">
          The plan and Puku allowance for <strong>{ctx.org.name}</strong>. You&apos;re signed in as {/^[aeiou]/i.test(roleLabel(ctx.role)) ? "an" : "a"} {roleLabel(ctx.role).toLowerCase()}.
        </p>
      </header>

      <Notices
        actionError={actionError}
        configured={configured}
        live={provider.live}
        canManage={canManage}
      />

      <PlanSection
        plan={plan}
        sub={sub}
        isPaid={isPaidPlan}
        canManage={canManage}
        resumeAction={resumeAction}
      />

      <UsageSection puku={puku} />

      {!isPaidPlan && configured ? (
        <UpgradeSection
          blurb={catalog.get("pro").blurb}
          monthlyLabel={monthlyLabel}
          yearlyLabel={yearlyLabel}
          canManage={canManage}
          hostedCheckout={provider.hostedCheckout}
          upgradeMonthly={upgradeMonthly}
          upgradeYearly={upgradeYearly}
        />
      ) : null}

      {isPaidPlan && configured && canManage ? (
        <ManageSection
          cancelAtPeriodEnd={sub.cancelAtPeriodEnd}
          manageAction={manageAction}
          cancelAction={cancelAction}
        />
      ) : null}

      {isPaidPlan && account ? <InvoicesSection orgSlug={orgSlug} invoices={account.invoices} /> : null}
    </div>
  );
}

function NotConfiguredPage() {
  return (
    <div className="wz-billingPage">
      <header className="wz-billingHeader wz-hero wz-heroCanyon">
        <h1 className="wz-billingTitle">Billing</h1>
        <p className="wz-billingSub">Billing isn&apos;t configured on this Weft.</p>
      </header>
    </div>
  );
}

function BillingPageFallback() {
  return (
    <div className="wz-billingPage">
      <header className="wz-billingHeader wz-hero wz-heroCanyon">
        <h1 className="wz-billingTitle">Billing</h1>
        <p className="wz-billingSub">Loading your workspace&apos;s plan…</p>
      </header>
    </div>
  );
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams?: Promise<Query>;
}) {
  const { orgSlug } = await params;
  if (!isDeployed()) return <NotDeployedCard slug={orgSlug} />;
  return (
    <Suspense fallback={<BillingPageFallback />}>
      <BillingPageBody orgSlug={orgSlug} searchParams={searchParams} />
    </Suspense>
  );
}
