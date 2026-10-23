"use client";

// Settings → Security: when each saved credential runs out. The tokens themselves live in the Keychain and
// never cross into the board — only the expiry BlastCP already reports through its status comes over, so this
// row adds no IPC and asks main for nothing a drawer hasn't already been told.
//
// BlastCP is the one that expires: its OAuth sign-in is 30 days with no refresh token, and expiryNote()
// already says when that runs out (it's the same note the 🚀 drawer shows, last week only). Vercel, Supabase
// and Cloudflare hand out API tokens that don't lapse, so theirs say so rather than being left blank. There's
// deliberately no quiet auto-refresh: re-consenting for you is worse than telling you it's nearly time.

import { useEffect, useState } from "react";
import { blastcpBridge, expiryNote } from "@/lib/blastcp-view";
import { useNow } from "@/lib/use-now";
import { SettingsSectionHeader } from "./SettingsLayout";

const API_TOKENS = ["Vercel", "Supabase", "Cloudflare"];

// null while BlastCP hasn't answered; the drawer has its own reconnect, so this only reports.
export default function TokenExpiry() {
  const now = useNow();
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const blastcp = blastcpBridge();
    if (!blastcp) return;
    blastcp.status([]).then(
      (s) => {
        setSignedIn(s.signedIn);
        setExpiresAt(s.expiresAt);
      },
      () => {},
    );
  }, []);

  // The note is written for BlastCP's own drawer, where it sits under an email; here it stands alone, so the
  // expiry line names the integration. Null from expiryNote means more than a week out, which isn't news.
  const blastcpNote = signedIn ? expiryNote(expiresAt, now) : null;

  return (
    <section className="flex flex-col gap-2.5">
      <SettingsSectionHeader
        title="Sign-in expiry"
        hint="How long each saved sign-in lasts. Keys in the vault and tokens for Vercel, Supabase and Cloudflare don't run out; BlastCP's sign-in does, and Weft tells you before it does."
      />
      <ul className="flex flex-col gap-1 text-[12.5px]">
        <li className="flex items-center justify-between gap-3">
          <span className="text-ink">BlastCP</span>
          <span className={blastcpNote ? "text-warn" : "text-muted"}>
            {signedIn ? (blastcpNote ?? "Signed in, no expiry") : "Not signed in"}
          </span>
        </li>
        {API_TOKENS.map((name) => (
          <li key={name} className="flex items-center justify-between gap-3">
            <span className="text-ink">{name}</span>
            <span className="text-muted">No expiry</span>
          </li>
        ))}
      </ul>
    </section>
  );
}