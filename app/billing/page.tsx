// The /billing entry on weft.zip: where the home page's pricing cards link (lib/billing/plan-link.ts). Like /team, it
// figures out which workspace the visitor is in and bounces to /[orgSlug]/billing, keeping ?plan= so that page opens
// the upgrade dialog on the plan they picked; signed out, it sends them to sign in and back here first.
//
// Reads cookies() and the query, so the body sits in <Suspense> for cacheComponents (next.config.ts).
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isWebEnabled } from "@/lib/home";
import { loginForPlan, wantedPlan, workspaceBillingPath } from "@/lib/billing/plan-link";
import { currentWorkspaceSlug } from "@/lib/teams";
import "@/components/team/team.css";

export const metadata = {
  title: "Billing",
  description: "Pick a plan for your Weft workspace.",
};

type Query = Record<string, string | string[] | undefined>;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">{title}</h1>
        <p className="wz-authSub">{children}</p>
      </main>
    </div>
  );
}

async function BillingRedirectBody({ searchParams }: { searchParams: Promise<Query> }) {
  const plan = wantedPlan((await searchParams).plan);
  const workspace = await currentWorkspaceSlug();
  if (workspace.kind === "signed-out") redirect(loginForPlan(plan));
  if (workspace.kind === "none") {
    return (
      <Card title="No workspace yet">
        Sign out and back in to create one; if it still doesn&apos;t appear, write to <a href="mailto:hello@weft.zip">hello@weft.zip</a>.
      </Card>
    );
  }
  redirect(workspaceBillingPath(workspace.slug, plan));
}

export default function Page({ searchParams }: { searchParams: Promise<Query> }) {
  if (!isWebEnabled()) return <Card title="Billing">Plans are bought on weft.zip. In the desktop app, Settings → Accounts has Upgrade.</Card>;
  return (
    <Suspense fallback={<Card title="Billing">Loading your workspace…</Card>}>
      <BillingRedirectBody searchParams={searchParams} />
    </Suspense>
  );
}
