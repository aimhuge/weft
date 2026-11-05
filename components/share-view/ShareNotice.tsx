// One line of why a share link shows nothing (not deployed, private, not set up), on weft.zip's sign-in card.
import type { ReactNode } from "react";

export function ShareNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="wz-app">
      <div className="wz-authCard">
        <h1 className="wz-authTitle">{title}</h1>
        <p className="wz-authSub">{children}</p>
      </div>
    </main>
  );
}

// A private link opened signed out. A card with a sign-in link rather than redirect(): the page body
// streams inside a <Suspense>, and a redirect thrown after the shell has gone out left the visitor on
// "Loading the app…" for good.
export function SignInNotice({ next }: { next: string }) {
  return (
    <ShareNotice title="Sign in to open this app">
      This app is private. <a href={`/login?next=${encodeURIComponent(next)}`}>Sign in</a> with an account it&apos;s shared with to open it.
    </ShareNotice>
  );
}
