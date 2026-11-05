"use client";

import { writeConsent, type Consent } from "@/lib/consent";
import { useConsent } from "@/lib/use-consent";

// The privacy page's "change your mind" control (app/privacy/page.tsx#cookies): shows the browser's current analytics
// choice and flips it. Going from yes to no reloads the page, since gtag.js can't be unloaded once it ran; PostHog
// stops at once (lib/analytics.ts) and the next load starts neither.
export default function ConsentChoice({ reload = () => location.reload() }: { reload?: () => void }) {
  const choice = useConsent();
  const choose = (value: Consent) => {
    writeConsent(value);
    if (choice === "granted" && value === "denied") reload();
  };
  const label = choice === "granted" ? "on" : choice === "denied" ? "off" : "off (you haven't chosen yet)";
  return (
    <p>
      Analytics cookies in this browser: <strong>{label}</strong>.{" "}
      {choice === "granted" ? (
        <button type="button" className="wz-legalButton" onClick={() => choose("denied")}>
          Turn them off
        </button>
      ) : (
        <button type="button" className="wz-legalButton" onClick={() => choose("granted")}>
          Turn them on
        </button>
      )}
    </p>
  );
}
