// Where Stripe Checkout sends you back to when you upgraded from the desktop app's upgrade dialog
// (docs/architecture/billing.md "The upgrade dialog"). It needs no sign-in: your system browser may not have a
// weft.zip session, and the plan itself is the webhook's to change, never this page's (`?checkout=done` is a hint
// anyone can type). It says what happened and links back into Weft (weft://board brings the window forward), where
// the dialog picks the new plan up.
import type { Metadata } from "next";
import { Suspense } from "react";
import "@/components/team/team.css";

export const metadata: Metadata = { title: "Checkout · Weft", robots: { index: false } };

type Query = Record<string, string | string[] | undefined>;

async function Body({ searchParams }: { searchParams?: Promise<Query> }) {
  const query = searchParams ? await searchParams : {};
  const canceled = query.checkout === "canceled";
  return (
    <main className="wz-authCard">
      <h1 className="wz-authTitle">{canceled ? "Checkout canceled" : "You're upgraded"}</h1>
      <p className="wz-authSub">
        {canceled
          ? "Nothing was charged. You can pick a plan again from Weft whenever you're ready."
          : "Thanks! Head back to Weft: it picks up your new plan in a few seconds."}
      </p>
      <p className="wz-authSub">
        <a href="weft://board" className="wz-inviteSubmit">
          Back to Weft
        </a>
      </p>
    </main>
  );
}

export default function Page({ searchParams }: { searchParams?: Promise<Query> }) {
  return (
    <div className="wz-app wz-auth">
      <Suspense fallback={<main className="wz-authCard" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
