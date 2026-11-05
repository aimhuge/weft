// The Privacy Policy for weft.zip, at /privacy: what the deployed Weft and the desktop app send us, why, who
// processes it, how long we keep it and how to get it deleted. The facts behind it are docs/architecture/analytics.md
// (GA4, PostHog, desktop onboarding stats, $ai_generation events), cloud-sync.md, feedback.md, site-notes.md,
// secrets.md (the keychain audit), billing.md and email-forwarding.md; change this page when one of those changes.
// A server component in the Terms' style (app/terms/page.tsx); only the analytics switch (ConsentChoice) is client JS.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import ConsentChoice from "@/components/ConsentChoice";
import emblem from "@/electron/assets/emblem.png";
import "@/components/home/home.css";

export const metadata: Metadata = {
  title: "Privacy Policy · Weft",
  description: "What weft.zip and the Weft app collect, why, who processes it, how long we keep it, and your choices.",
};

const UPDATED = "October 27, 2026";
const CONTACT = "legal@weft.zip";

export default function PrivacyPage() {
  return (
    <div className="wz-root">
      <div className="wz-wrap wz-legalBar">
        <Link href="/" className="wz-brand">
          <Image src={emblem} alt="" width={28} height={28} className="wz-emblem" /> Weft
        </Link>
      </div>

      <main className="wz-legal">
        <p className="wz-loginEyebrow">Last updated {UPDATED}</p>
        <h1>Privacy Policy</h1>
        <p>
          This policy explains what Alex Miller, doing business as AIMHUGE (&quot;Weft&quot;, &quot;we&quot;,
          &quot;us&quot;), collects when you use weft.zip, the Weft app and the services described in our{" "}
          <Link href="/terms">Terms of Service</Link>, why, and what you can do about it. We are the controller of
          this data. Questions go to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>

        <h2>1. The short version</h2>
        <ul>
          <li>The Weft app runs on your Mac. Your board, prompts, code and replies stay there unless you turn on a feature that sends them.</li>
          <li>Analytics on weft.zip (Google Analytics and PostHog, with session replay) start only after you accept them.</li>
          <li>The app sends anonymous onboarding stats by default; you can switch them off in Settings → Security.</li>
          <li>We don&apos;t sell your data, and we don&apos;t use your content to train AI models.</li>
          <li>If you connect a Google account, its data goes from Google to your Mac and nowhere we can see. See <a href="#google">Google user data</a>.</li>
        </ul>

        <h2>2. What we collect, and why</h2>
        <p>
          <strong>Your account.</strong> When you sign in with GitHub we get your email address, name, GitHub
          username and avatar, and we record when you last signed in. We use them to run your account and
          workspaces, to show your profile if you make one public, and to contact you about the services.
        </p>
        <p>
          <strong>What you choose to sync or share.</strong> Cloud sync is off until you turn it on for a project. Then
          the cards, threads, tool output, images, attachments and pages of that project are uploaded so your other
          devices, the web board, your workspace and share links can show them. They travel encrypted and our
          database host encrypts them at rest, but they aren&apos;t end-to-end encrypted: we could technically read
          them, and only do so to run, secure or fix the services, or when the law requires it. Secrets in the 🔐 vault are the
          exception: they&apos;re end-to-end encrypted and we only ever hold ciphertext.
        </p>
        <p>
          <strong>Site notes</strong> you save are scrubbed of query strings, tokens, emails and similar before they
          leave your Mac, and go to your workspace, or to everyone only if you choose public and press Send.
        </p>
        <p>
          <strong>Feedback.</strong> When you send feedback from the app we store the conversation, its summary, your
          name, email and app version, and post the summary with your name and email to our team&apos;s Slack.
        </p>
        <p>
          <strong>Security log.</strong> While you&apos;re signed in, the app records when the 🔐 vault is unlocked or a
          secret is used (which secret, when, from which card), never the secret itself, in an audit log in your
          account, so you can see what touched your keys.
        </p>
        <p>
          <strong>Billing.</strong> If you buy Pro, Stripe collects your payment details; we receive your plan, billing
          status and what Stripe shares with us about the payment, never your full card number.
        </p>
        <p>
          <strong>Email and webhooks.</strong> Mail sent to a weft.zip address is received and held by our email
          provider and forwarded on. Webhook deliveries to the relay pass through our servers to your Mac.
        </p>
        <p>
          <strong>AI features we run.</strong> When weft.zip runs an AI model for you (the feedback interview, a
          title, a summary), the text sent to the model and its reply are logged with token counts and timing in our
          product analytics, so we can find bugs and keep costs in check. AI agents you run on your Mac talk to
          their own providers under those providers&apos; terms, not through us.
        </p>
        <p>
          <strong>Analytics on weft.zip</strong>, only after you accept: pages viewed, clicks, device and browser,
          approximate location from your IP address, errors, and recordings of how you used the page (session replay).
          If you&apos;re signed in, PostHog links this to your account id, name and email. We use it to understand what
          works and to fix what doesn&apos;t. More in <a href="#cookies">Cookies</a>.
        </p>
        <p>
          <strong>Desktop onboarding stats.</strong> The app reports which welcome steps you went through, as
          anonymous events tied to a hashed device id: never a prompt, project name, path, email or card. They&apos;re
          on by default; switch them off in the app under Settings → Security.
        </p>
        <p>
          <strong>Server logs.</strong> Our hosts keep request logs (IP address, time, page, browser) for security and
          debugging.
        </p>

        <h3 id="google">Google user data</h3>
        <p>
          You can connect a Google account in the app (Settings → Connectors) so your AI agents can work with your
          Gmail, Calendar, Drive, Docs, Sheets, Slides, Contacts and Tasks. Weft asks Google only for the access
          those tasks need, and you see each permission on Google&apos;s consent screen before you grant it.
        </p>
        <ul>
          <li>
            <strong>Where it lives.</strong> Google&apos;s sign-in token is kept in your Mac&apos;s Keychain. Your mail,
            events, files, contacts and tasks are fetched by the app on your Mac straight from Google; they don&apos;t
            pass through or get stored on weft.zip, and we never see them.
          </li>
          <li>
            <strong>How it&apos;s used.</strong> Only to do what you ask: an agent reads, drafts, sends, files or edits
            when you tell it to. When an agent works with Google data, the part it needs goes to the AI provider that
            agent runs on (for example Anthropic), under that provider&apos;s terms, to produce the answer you asked for.
          </li>
          <li>
            <strong>What we never do.</strong> We don&apos;t sell Google user data, use it for advertising, let people
            read it (except with your permission, for security, or when the law requires it), or use it to develop,
            improve or train AI or machine-learning models.
          </li>
          <li>
            <strong>Removing access.</strong> Remove the account in Settings → Connectors, which deletes its token from
            your Keychain, or revoke Weft at{" "}
            <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
          </li>
        </ul>
        <p>
          Weft&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>

        <h2>3. Legal bases</h2>
        <p>
          Where the GDPR or UK GDPR applies, we rely on: <strong>contract</strong> for your account, sync, sharing,
          email, the relay and billing; <strong>consent</strong> for analytics cookies and session replay on weft.zip;
          and <strong>legitimate interests</strong> for security logs, feedback you send, AI usage logs, and the
          anonymous onboarding stats, which you can switch off. We keep billing records because the law requires it.
        </p>

        <h2>4. Who processes it for us</h2>
        <ul>
          <li><strong>Vercel</strong>: hosts weft.zip and runs its servers (Singapore region).</li>
          <li><strong>Supabase</strong>: our database, sign-in and file storage (Singapore region).</li>
          <li><strong>GitHub</strong>: sign-in.</li>
          <li><strong>Google Analytics</strong> and <strong>PostHog</strong>: website and product analytics, session replay, error reports.</li>
          <li><strong>Stripe</strong>: payments and invoices.</li>
          <li><strong>Slack</strong>: where our team reads feedback.</li>
          <li><strong>Resend</strong>: email to and from weft.zip addresses.</li>
          <li><strong>Anthropic</strong> and <strong>Puku</strong>: the AI models weft.zip calls for its own features.</li>
        </ul>
        <p>
          Some of them are in the United States or elsewhere outside your country. Where the law requires it, transfers
          rely on safeguards such as the European Commission&apos;s standard contractual clauses. We share data with
          others only when the law requires it, to protect people or the services, or as part of a sale or transfer
          of Weft, under this policy.
        </p>

        <h2 id="cookies">5. Cookies and analytics</h2>
        <p>
          weft.zip uses a sign-in cookie and stores your theme and this choice in your browser; these are needed for
          the site to work. Google Analytics and PostHog set their own cookies and record sessions, and they only
          load after you press Accept in the banner. Declining, or ignoring the banner, keeps them off. You can change
          your mind here at any time:
        </p>
        <ConsentChoice />
        <p>A Weft running on your own Mac never loads either of them.</p>

        <h2>6. How long we keep it</h2>
        <ul>
          <li>Account, synced content, site notes and the security log: until you delete them or your account.</li>
          <li>Feedback: as long as it&apos;s useful for improving Weft, at most 3 years.</li>
          <li>Analytics, session replays and AI usage logs: as long as our analytics provider keeps them, at most 2 years.</li>
          <li>Billing records: as long as tax law requires, usually 5 to 10 years.</li>
          <li>Server logs: a few weeks.</li>
        </ul>

        <h2>7. Your rights and deleting your data</h2>
        <p>
          Depending on where you live, you can ask to see, correct, export or delete your personal data, object to or
          restrict how we use it, and withdraw consent at any time (which doesn&apos;t affect what happened before).
          You can turn sync off per project and delete synced cards yourself. To delete your account and everything in
          it, or for any other request, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address on your
          account; we&apos;ll reply within 30 days. You can also complain to your data protection authority.
        </p>
        <p>
          California residents: we don&apos;t sell or share personal information for cross-context behavioral
          advertising, and you won&apos;t be treated differently for using these rights.
        </p>

        <h2>8. Security</h2>
        <p>
          We encrypt data in transit, keep vault secrets end-to-end encrypted, and limit who can reach our systems. No
          service is perfectly secure; if a breach affects you, we&apos;ll tell you as the law requires. Report
          security issues to {CONTACT}.
        </p>

        <h2>9. Children</h2>
        <p>
          Weft is not for anyone under 16, and we don&apos;t knowingly collect their data. If you think a child has
          given us data, write to us and we&apos;ll delete it.
        </p>

        <h2>10. Changes</h2>
        <p>
          We&apos;ll update this page when what we collect changes, and change the date at the top. For a material
          change we&apos;ll give at least 14 days&apos; notice by email or in the app.
        </p>

        <h2>11. Law</h2>
        <p>
          This policy is governed by the laws of Thailand, including the Personal Data Protection Act, and the courts
          of Chiang Mai have jurisdiction, as in our <Link href="/terms">Terms</Link>, except where the law of the
          country you live in gives you more protection or the right to bring a claim at home.
        </p>

        <h2>Contact</h2>
        <p>
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </main>
    </div>
  );
}
