// The billing page's pieces for the plans that aren't the full Pro price (docs/architecture/billing.md): the
// regional price note above the upgrade card, and the Open Source / Education card for a workspace on Free or a grant.
import { formatMoney } from "@aimhuge/billing";
import type { RegionalPick } from "@/lib/billing/regional-pick";

// "Pro is $5/month here": shown when the visitor's country or the workspace's billing address qualifies and the
// page can sell Pro (`show`). A paying workspace never gets a pick.
export function RegionalNote({ pick, show }: { pick: RegionalPick | null; show: boolean }) {
  if (!pick || !show) return null;
  const monthlyCents = pick.monthlyCents;
  return (
    <p className="wz-billingSub">
      <strong>Regional pricing:</strong> Pro is {formatMoney(monthlyCents)}/month where you are, with the same allowance.
      Upgrade monthly to get it.
    </p>
  );
}

// Free plans for open source and education, on a workspace that doesn't pay. A granted plan shows when it ends;
// Free offers the GitHub check.
export function FreePlansSection({
  plan,
  grantEnds,
  lapsed,
  canManage,
  checkAction,
}: {
  plan: string;
  grantEnds: string | null;
  lapsed: boolean;
  canManage: boolean;
  checkAction: (formData: FormData) => Promise<void>;
}) {
  if (plan === "pro" || plan === "team") return null;
  const granted = plan === "oss" || plan === "edu";
  const ends = grantEnds ? new Date(grantEnds).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : null;
  return (
    <section className="wz-billingSection">
      <h2 className="wz-billingSectionTitle">Open source and education</h2>
      {granted && !lapsed && ends ? (
        <p className="wz-billingSub">Granted until {ends}. Signing in during its last month renews it.</p>
      ) : null}
      {granted && lapsed ? <p className="wz-billingSub">This grant has ended, so the workspace is on Free until it&apos;s renewed.</p> : null}
      <p className="wz-billingSub">
        Maintain an active, non-fork public repo with an open-source licence? Weft checks your GitHub when you sign in and
        moves the workspace onto Open Source for a year: teams and BlastCP Creator, free. Students and teachers get the same
        through the GitHub Student Developer Pack.
      </p>
      {canManage && (plan === "free" || lapsed || plan === "oss") ? (
        <form action={checkAction}>
          <button type="submit" className="wz-billingButton">Check my GitHub now</button>
        </form>
      ) : null}
    </section>
  );
}
