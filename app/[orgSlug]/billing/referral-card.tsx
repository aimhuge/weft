// The billing page's referral card (docs/architecture/billing.md "Coupons and referrals"): the workspace's code to share,
// what it gives, and for an owner or admin without one yet a button that makes it.
import { referralOfferLabel } from "@/lib/billing/referral-terms";

// `show` is off on a Weft without Stripe: there is no code to make.
export function ReferralSection({ show, code, canManage, action }: { show: boolean; code: string | null; canManage: boolean; action: (formData: FormData) => Promise<void> }) {
  if (!show) return null;
  return (
    <section className="wz-billingSection">
      <h2 className="wz-billingSectionTitle">Refer a team</h2>
      <p className="wz-billingSub">Another workspace types your code at checkout: {referralOfferLabel()}.</p>
      {code ? (
        <p className="wz-billingSub">
          Your code: <strong style={{ fontFamily: "var(--font-mono, monospace)", userSelect: "all" }}>{code}</strong>
        </p>
      ) : canManage ? (
        <form action={action}>
          <button type="submit" className="wz-billingButton">Get our referral code</button>
        </form>
      ) : (
        <p className="wz-billingSub">An owner or admin can get the workspace&apos;s code here.</p>
      )}
    </section>
  );
}
