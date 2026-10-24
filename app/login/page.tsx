// The /login page on the deployed weft.zip. Mirrors the package's recommended
// shape: <Suspense> + readSessionIdentity + SignedInPrompt + LoginForm, with
// safeNextPath on the `?next=` param. Today the form is a thin wrapper that
// renders one "Continue with GitHub" button; the magic-link row is opt-in.
// Two panels: the twin-suns speeder with the pitch, and the sign-in as a glass card over
// the cockpit (the copilot's picture); stacks on a phone.
//
// On the deployed site the form is a set of plain GET links to /auth/sign-in
// and the signed-in prompt is a POST form to /auth/sign-out — the cookie
// session is on the same origin, so a no-JS round trip is the whole job. The
// desktop / `next dev` flow keeps the JS-driven useAuth() path.
//
// Only rendered on the deployed site (Vercel / WEFT_HOME); in the desktop app
// the board's sign-in dialog is the way in, not this page.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm, SignedInPrompt, readSessionIdentity, safeNextPath } from "@/lib/auth";
import { isWebEnabled } from "@/lib/home";
import emblem from "@/electron/assets/emblem.png";
import speeder from "@/electron/assets/splash-speeder.jpg";
import cockpit from "@/public/copilots/wingman.jpg";
import "@/components/home/home.css";

const DEFAULT_NEXT = "/team";

export const metadata: Metadata = {
  title: "Sign in to Weft",
  description: "Sign in to Weft with GitHub to sync your boards and unlock cloud features.",
};

function Shell({ children, description }: { children?: React.ReactNode; description: string }) {
  return (
    <div className="wz-root wz-login">
      <aside className="wz-loginAside">
        <Image src={speeder} alt="" fill priority sizes="(max-width: 860px) 100vw, 55vw" className="wz-loginScene" />
        <span aria-hidden="true" className="wz-loginScrim" />
        <Link href="/" className="wz-loginBrand">
          <Image src={emblem} alt="" width={28} height={28} className="wz-emblem" />
          Weft
        </Link>

        <div className="wz-loginPitch">
          <h1 className="wz-loginHeadline">
            Pick up <em>the thread</em>.
          </h1>
          <p className="wz-loginLede">A board for your AI threads, synced wherever you sit down to work.</p>
        </div>
      </aside>

      <div className="wz-loginPanel">
        <Image src={cockpit} alt="" fill sizes="(max-width: 860px) 100vw, 45vw" className="wz-loginCockpit" />
        <span aria-hidden="true" className="wz-loginCockpitScrim" />
        <div className="wz-loginBar">
          <Link href="/" className="wz-loginBack">Back to weft.zip</Link>
        </div>

        <main className="wz-loginMain">
          <section className="wz-loginCard">
            <p className="wz-loginEyebrow">Weft account</p>
            <h2 className="wz-loginTitle">Sign in to Weft</h2>
            <p className="wz-loginSubtitle">{description}</p>
            {children}
          </section>
        </main>

        <footer className="wz-loginFooter">weft.zip</footer>
      </div>
    </div>
  );
}

async function LoginBody({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ next }, identity] = await Promise.all([searchParams, readSessionIdentity()]);
  const safeNext = safeNextPath(next, DEFAULT_NEXT);
  return (
    <>
      {identity && <SignedInPrompt identity={identity} next={safeNext} deployed />}
      <LoginForm defaultNext={safeNext} providers={["github"]} deployed />
    </>
  );
}

function LoginBodyFallback() {
  return (
    <div className="wz-loginChecking">
      <span className="wz-loginSpinner" aria-hidden="true" />
      Checking your account
    </div>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // In plain `next dev` (no Vercel / WEFT_HOME) the page is a no-op marker.
  if (!isWebEnabled()) {
    return (
      <Shell description="In the desktop app, the board&apos;s sign-in button is how you sign in." />
    );
  }
  // searchParams is awaited inside <LoginBody>, which is a Server Component
  // wrapped in <Suspense>; we hand the promise straight through.
  return (
    <Shell description="An account syncs your boards across machines, turns on share links and runs the Puku trial on Weft&apos;s key. Optional: the desktop app works signed out.">
      <Suspense fallback={<LoginBodyFallback />}>
        <LoginBody searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}
