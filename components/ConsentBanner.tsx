"use client";

import Link from "next/link";
import { isLocalHost } from "@/lib/analytics-gate";
import { writeConsent } from "@/lib/consent";
import { useConsent } from "@/lib/use-consent";

// The weft.zip analytics ask (lib/consent.ts): one small bar in the bottom corner until the visitor answers, then
// gone for good on that browser. app/layout.tsx mounts it only when isDeployed(); a local board, where nothing calls
// home, never shows it. It renders after hydration (useConsent() is undefined until then), since the choice is only
// known in the browser; answering fires writeConsent()'s event, which hides it.
export default function ConsentBanner({ hostname }: { hostname?: string }) {
  const choice = useConsent();
  if (choice !== null || isLocalHost(hostname ?? location.hostname)) return null;
  return (
    <div
      role="dialog"
      aria-label="Analytics cookies"
      className="fixed bottom-3 left-3 z-50 flex max-w-[380px] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-panel px-3 py-2 text-[12px] text-ink shadow-lg"
    >
      <span className="flex-1 basis-[220px]">
        May we use cookies for analytics and session replay (Google Analytics, PostHog)?{" "}
        <Link href="/privacy#cookies" className="text-accent hover:underline">
          Privacy
        </Link>
      </span>
      <span className="flex gap-1.5">
        <button onClick={() => writeConsent("denied")} className="rounded px-2 py-0.5 text-muted hover:text-ink">
          Decline
        </button>
        <button onClick={() => writeConsent("granted")} className="rounded bg-accent px-2 py-0.5 font-medium text-on-accent hover:opacity-90">
          Accept
        </button>
      </span>
    </div>
  );
}
