// The /app page: where a successful sign-in lands on weft.zip. Today the
// deployed site is the marketing surface, not a product, so this is a small
// "you're in" card with a download CTA. If the cloud product grows a
// synced-boards list later, it goes here. The "Your team" link opens the
// visitor's workspace; a fresh account has a personal workspace seeded by the
// /auth/callback's on_auth_user_created_workspace trigger.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { readSessionIdentity } from "@/lib/auth";
import { downloadLink } from "@/lib/home";
import { latestRelease } from "@/lib/home-release";
import "@/components/team/team.css";

export const metadata: Metadata = {
  title: "Signed in to Weft",
  description: "You're signed in to Weft.",
};

async function AppBody() {
  // The "you're in" pill only renders when the session actually exists; the
  // shell still renders when the cookie is missing so a deep link doesn't
  // bounce the visitor.
  const identity = await readSessionIdentity();
  const download = downloadLink(await latestRelease(), "signed-in");
  const who = identity?.name ?? identity?.email ?? "your Weft account";
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">You&apos;re signed in</h1>
        <p className="wz-authSub">
          {identity ? `Signed in as ${who}.` : "Your Weft account is ready."} The desktop app uses this account to
          sync boards, enable share links, and run the Puku trial on Weft&apos;s key.
        </p>
        <div className="wz-ctas" style={{ marginTop: 16 }}>
          <Link className="wz-btn wz-btnPrimary" href="/team">
            Your team →
          </Link>
        </div>
        <p className="wz-note" style={{ marginTop: 14 }}>
          <a href={download.href}>{download.label}</a>
        </p>
        <p className="wz-authSub" style={{ marginTop: 24, fontSize: 13 }}>
          <Link href="/">← Back to weft.zip</Link>
        </p>
      </main>
    </div>
  );
}

function AppFallback() {
  return (
    <div className="wz-app wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Signed in to Weft</h1>
        <p className="wz-authSub wz-loading">Loading your account…</p>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<AppFallback />}>
      <AppBody />
    </Suspense>
  );
}
