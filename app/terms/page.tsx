// The Terms of Service for weft.zip, at /terms. The code's license is LICENSE (FSL-1.1-ALv2 with Weft Additional Terms) and the name's is
// TRADEMARKS.md; these terms cover the services the deployed Weft runs: accounts, workspaces, cloud sync, the web
// board, the webhook relay, included AI usage and Pro. A server component with no client JS, in the home's palette.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import emblem from "@/electron/assets/emblem.png";
import { REPO } from "@/lib/home";
import "@/components/home/home.css";

export const metadata: Metadata = {
  title: "Terms of Service · Weft",
  description: "The terms for using weft.zip: your account, your content, fair use, plans and the rest.",
};

const UPDATED = "October 16, 2026";
const CONTACT = "legal@weft.zip";

export default function TermsPage() {
  return (
    <div className="wz-root">
      <div className="wz-wrap wz-legalBar">
        <Link href="/" className="wz-brand">
          <Image src={emblem} alt="" width={28} height={28} className="wz-emblem" /> Weft
        </Link>
      </div>

      <main className="wz-legal">
        <p className="wz-loginEyebrow">Last updated {UPDATED}</p>
        <h1>Terms of Service</h1>
        <p>
          These terms are an agreement between you and Alex Miller, doing business as AIMHUGE (&quot;Weft&quot;,
          &quot;we&quot;, &quot;us&quot;), for using weft.zip and the online services the Weft app connects to. By
          creating an account or using those services, you agree to them. If you use Weft for a company, you agree
          for that company, and you confirm you&apos;re allowed to.
        </p>

        <h2>1. What these terms cover</h2>
        <p>
          The <strong>Weft app</strong> runs on your Mac. Its source code is licensed under{" "}
          <a href={`${REPO}/blob/main/LICENSE`}>FSL-1.1-ALv2 with Weft Additional Terms</a>, and that license, not these terms, governs what you
          can do with the code. You can use the app without an account.
        </p>
        <p>
          The <strong>services</strong> are everything we run for you online: Weft accounts, workspaces and invites,
          card sync and the web board, the webhook relay, email to weft.zip addresses, AI usage included with your
          plan, billing, and any profiles, streaks, leaderboards or feeds we add. These terms govern the services.
        </p>

        <h2>2. Your account</h2>
        <ul>
          <li>You must be at least 16, and old enough to agree to these terms where you live.</li>
          <li>One account per person. Give us accurate details and keep your sign-in secure.</li>
          <li>You&apos;re responsible for what happens under your account, including what agents do with it.</li>
          <li>Tell us at {CONTACT} if you think someone else got into your account.</li>
        </ul>

        <h2>3. Your content</h2>
        <p>
          Your cards, threads, code, pages, images and files are yours. You give us permission to store, copy,
          process and show them only as needed to run the services for you and the people you share them with, for
          example to sync a card to your other devices or show it to your workspace. We don&apos;t sell your content,
          and we don&apos;t use it to train AI models. Our <Link href="/privacy">Privacy Policy</Link> explains
          what we collect and why.
        </p>
        <p>
          You confirm you have the right to upload what you upload, and that it doesn&apos;t break the law or anyone
          else&apos;s rights. Anything you choose to make public (a profile, a shared card, a post to a feed) can be
          seen, linked and shared by others.
        </p>

        <h2>4. AI and the agents you run</h2>
        <p>
          Weft starts AI coding agents on your Mac and can connect them to third-party AI providers. Those providers&apos;
          own terms apply to your use of them. AI output can be wrong, insecure or unoriginal: review it before you rely
          on it, ship it or run it. The agents act on your computer, your files and your accounts on your behalf, and you
          are responsible for what you ask them to do and what they do.
        </p>

        <h2>5. Fair use</h2>
        <p>Using the services, you won&apos;t:</p>
        <ul>
          <li>break the law, or infringe anyone&apos;s rights;</li>
          <li>harass, threaten, impersonate or spam anyone, post hateful content, or post any sexual content involving minors;</li>
          <li>send malware, phishing or abuse through the webhook relay, email forwarding or any other service;</li>
          <li>
            scrape, crawl or bulk-collect data from weft.zip, its profiles or its feeds, except through an API we
            publish for that;
          </li>
          <li>
            access the services with bots, scripts or unofficial apps except through an API we publish and its own
            terms; that includes forks of Weft calling our servers without our written permission;
          </li>
          <li>
            fake activity or cheat to earn streaks, XP, badges or leaderboard spots, or open extra accounts to stretch
            free usage, trials or limits;
          </li>
          <li>resell, sublicense or share access to the services, or included AI usage, outside your workspace;</li>
          <li>
            probe, overload or get around our security, rate limits or usage caps, or reverse-engineer the services
            (the published source code is fine to read under its license);
          </li>
          <li>use the services to build a competing hosted service.</li>
        </ul>
        <p>
          If you find a security issue, email {CONTACT} instead of testing it on other people&apos;s data. Good-faith
          reports are welcome.
        </p>

        <h2>6. Profiles, streaks and points</h2>
        <p>
          Streaks, XP, badges, levels and rankings are a game. They have no cash value, can&apos;t be sold or
          transferred, and we may change, reset or remove them, including when we see cheating. Public profiles show
          what you choose to share; you can hide or delete yours.
        </p>

        <h2>7. Workspaces</h2>
        <p>
          Whoever creates a workspace, and its admins, decide who&apos;s in it and what it shares. Content you put in a
          workspace is visible to its members. If you join a workspace through your employer or a client, they may
          control it, and its plan.
        </p>

        <h2>8. Plans, payment and included AI usage</h2>
        <ul>
          <li>
            Free gives you the app, an account and limited included AI usage. We may set or change free limits at any
            time.
          </li>
          <li>
            Pro is billed per workspace, monthly or yearly, at the price shown when you subscribe. It renews
            automatically until you cancel. Cancel anytime from the billing page; Pro stays on until the end of the
            period you paid for.
          </li>
          <li>
            Payments are handled by Stripe. Prices don&apos;t include taxes unless we say so. Except where the law
            says otherwise, payments aren&apos;t refundable, but write to us if something went wrong and we&apos;ll be
            fair.
          </li>
          <li>We&apos;ll tell you at least 30 days before a price change that affects your plan.</li>
          <li>Included AI usage is for your own work in Weft. Unused allowance doesn&apos;t carry over.</li>
        </ul>

        <h2>9. The Weft name</h2>
        <p>
          Weft™, the Weft logo and weft.zip are our trademarks. The code&apos;s license doesn&apos;t grant them; see{" "}
          <a href={`${REPO}/blob/main/TRADEMARKS.md`}>TRADEMARKS.md</a> for what&apos;s fine without asking.
        </p>

        <h2>10. Feedback and contributions</h2>
        <p>
          If you send ideas or feedback, we may use them without owing you anything. Code contributions to the repo are
          covered by <a href={`${REPO}/blob/main/CONTRIBUTING.md`}>CONTRIBUTING.md</a>, not these terms.
        </p>

        <h2>11. Changes and availability</h2>
        <p>
          Weft is young and changes quickly. We may add, change or stop features, and the services may sometimes be
          down. If we shut down a service you rely on, we&apos;ll give you reasonable notice and a way to export your
          content. We may change these terms; for a material change we&apos;ll give at least 14 days&apos; notice by
          email or in the app, and continuing to use the services after that means you accept the new terms.
        </p>

        <h2>12. Suspension and ending</h2>
        <p>
          You can stop using the services and delete your account anytime. We may suspend or close an account that
          breaks these terms, puts others at risk, or that the law requires us to, and we&apos;ll tell you why unless
          we can&apos;t. Sections 9 and 13 to 16 still apply after an account ends.
        </p>

        <h2>13. Disclaimers</h2>
        <p>
          The services are provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind,
          including fitness for a particular purpose, non-infringement, and that they&apos;ll be uninterrupted,
          error-free or secure. Keep your own copies of anything important; Weft isn&apos;t a backup.
        </p>

        <h2>14. Limits on liability</h2>
        <p>
          To the extent the law allows, we aren&apos;t liable for indirect, incidental, special, consequential or
          punitive damages, or for lost profits, data or goodwill, and our total liability for any claim about the
          services is the greater of what you paid us in the 12 months before the claim or US$50. Some places
          don&apos;t allow these limits, so they may not all apply to you.
        </p>
        <p>
          You&apos;ll cover our reasonable costs from claims by others caused by your content, your use of the
          services in breach of these terms, or what your agents do.
        </p>

        <h2>15. Law and disputes</h2>
        <p>
          These terms are governed by the laws of Thailand, and the courts of Chiang Mai have jurisdiction, except
          where the law of the country you live in gives you the right to bring a claim at home. Before going to court,
          write to us so we can try to sort it out.
        </p>

        <h2>16. The rest</h2>
        <p>
          These terms are the whole agreement about the services. If one part can&apos;t be enforced, the rest still
          stands. Not enforcing a part isn&apos;t giving it up. You can&apos;t transfer these terms; we can, to whoever
          takes over Weft.
        </p>

        <h2>Contact</h2>
        <p>
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </main>
    </div>
  );
}
