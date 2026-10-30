"use client";

// /pair's client half (app/pair/page.tsx, docs/architecture/mobile-security.md): reads the pairing link's # (kept in
// sessionStorage across a sign-in, which drops it), and on Pair makes this browser's keys and claims the code
// (lib/web-sync-key.ts pairThisBrowser). The Mac checks the claim and asks Touch ID; this page waits for it.
import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useState } from "react";
import { parsePairingLink } from "@/lib/pairing-link";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase-project";
import { pairThisBrowser } from "@/lib/web-sync-key";

export const PENDING_LINK_KEY = "weft-pair-link";

type Phase = "ready" | "waiting" | "paired" | "refused" | "expired" | "broken";

const MESSAGES: Record<Exclude<Phase, "ready">, string> = {
  waiting: "Waiting for your Mac. Confirm with Touch ID there.",
  paired: "Paired. Your web board can now read sealed threads.",
  refused: "Your Mac didn't pair this browser. Make a new code in Settings → Sync and try again.",
  expired: "The code ran out. Make a new one in Settings → Sync on your Mac.",
  broken: "This page needs the whole pairing link. Copy it again from Settings → Sync on your Mac.",
};

function readLink(): string | null {
  const here = window.location.href;
  if (parsePairingLink(here)) {
    sessionStorage.setItem(PENDING_LINK_KEY, here);
    return here;
  }
  return sessionStorage.getItem(PENDING_LINK_KEY);
}

export default function PairBrowser({ user }: { user: { id: string; name: string } | null }) {
  const [link, setLink] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);

  // The # lives only in the browser, so it's read after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setLink(readLink()), []);

  if (!user) {
    const params = new URLSearchParams({ provider: "github", next: "/pair" });
    return (
      <>
        <p className="wz-authSub">Sign in with the account your Mac uses, and this page picks up where it left off.</p>
        <div className="wz-ctas" style={{ marginTop: 16 }}>
          <a className="wz-btnPrimary" href={`/auth/sign-in?${params.toString()}`} onClick={() => readLink()}>
            Continue with GitHub →
          </a>
        </div>
      </>
    );
  }
  const parsed = link ? parsePairingLink(link) : null;
  if (!parsed) return <p className="wz-authSub">{MESSAGES.broken}</p>;

  const signedIn = user;
  const pairLink = link;
  async function pair() {
    if (!pairLink) return;
    setPhase("waiting");
    setError(null);
    try {
      const client = createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
      const name = `${signedIn.name || "Weft"} · ${navigator.userAgent.includes("Chrome") ? "Chrome" : navigator.userAgent.includes("Safari") ? "Safari" : "Browser"}`;
      const result = await pairThisBrowser(client, pairLink, { id: signedIn.id, name });
      sessionStorage.removeItem(PENDING_LINK_KEY);
      setPhase(result);
    } catch (err) {
      setPhase("ready");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <p className="wz-authSub">
        This browser will be able to read your sealed threads on the web board. It can&apos;t approve tool runs; only a paired phone can.
      </p>
      {phase === "ready" ? (
        <div className="wz-ctas" style={{ marginTop: 16 }}>
          <button type="button" className="wz-btnPrimary" onClick={() => void pair()}>
            Pair this browser
          </button>
        </div>
      ) : (
        <p className="wz-authSub" style={{ marginTop: 16 }}>
          {MESSAGES[phase]}
        </p>
      )}
      {error && (
        <p className="wz-authSub" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
    </>
  );
}
