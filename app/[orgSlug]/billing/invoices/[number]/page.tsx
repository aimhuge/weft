// The /[orgSlug]/billing/invoices/[number] page on weft.zip (docs/architecture/billing.md): one invoice as a full
// sheet, the page a ticket on the Billing page opens. The gate is the workspace's own (requireTeam), and the invoice
// is read through the billing binding, which scopes it to the org, so another workspace's number is a 404.
//
// Wrapped in <Suspense> for cacheComponents like its siblings: the gate reads cookies and the params are request data.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isWebEnabled } from "@/lib/home";
import { requireTeam } from "@/lib/teams";
import { billing, billingService } from "@/lib/billing/billing";
import { InvoiceSheet } from "@/components/team/InvoiceSheet";

export const metadata: Metadata = {
  title: "Invoice",
  description: "An invoice for your Weft workspace.",
};

function NotDeployedCard() {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Invoice</h1>
        <p className="wz-authSub">Workspaces live on weft.zip. In the desktop app, the board&apos;s account button is the way in.</p>
      </main>
    </div>
  );
}

function InvoiceFallback() {
  return <p className="wz-workspaceLoading wz-loading">Loading the invoice…</p>;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

type Account = Awaited<ReturnType<typeof billing.account>> | null;

// The addressee: the workspace's billing profile when it has one, else the workspace and its owner.
function billedToFor(account: Account, ctx: { org: { name: string }; user: { email: string | null } }) {
  const profile = account?.profile;
  return {
    name: profile?.companyName?.trim() || ctx.org.name,
    email: profile?.billingEmail ?? account?.ownerEmail ?? ctx.user.email,
  };
}

// "Visa ··4242" for the default card (or the first), nothing when there's none on file.
function methodLabel(account: Account): string | null {
  const card = account?.paymentMethods.find((m) => m.isDefault) ?? account?.paymentMethods[0];
  return card ? `${capitalize(card.brand)} ··${card.last4}` : null;
}

async function InvoiceBody({ orgSlug, number }: { orgSlug: string; number: string }) {
  const ctx = await requireTeam(orgSlug, `/${orgSlug}/billing/invoices/${encodeURIComponent(number)}`);
  const service = billingService();
  if (!service) notFound();
  const [invoice, account] = await Promise.all([
    billing.invoice(service, ctx.org.id, number),
    billing.account(service, ctx.org.id).catch(() => null),
  ]);
  if (!invoice) notFound();

  return (
    <InvoiceSheet
      invoice={invoice}
      billedTo={billedToFor(account, ctx)}
      method={methodLabel(account)}
      backHref={`/${orgSlug}/billing`}
    />
  );
}

async function InvoiceFor({ params }: { params: Promise<{ orgSlug: string; number: string }> }) {
  const { orgSlug, number } = await params;
  if (!isWebEnabled()) return <NotDeployedCard />;
  return <InvoiceBody orgSlug={orgSlug} number={decodeURIComponent(number)} />;
}

export default function Page({ params }: { params: Promise<{ orgSlug: string; number: string }> }) {
  return (
    <Suspense fallback={<InvoiceFallback />}>
      <InvoiceFor params={params} />
    </Suspense>
  );
}
