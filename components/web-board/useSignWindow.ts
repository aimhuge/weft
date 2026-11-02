"use client";

// Allow with a passkey, from the weft.zip board (docs/architecture/mobile-security.md, "Passkey approvals"). The
// passkey lives on sign.weft.zip, never here, so the board only opens that page in a new top-level tab with the card
// and pending ids (noopener: no window handle, no messages, no tokens). That page reads the ask itself, shows all of
// it, signs, and sends the answer; the board sees the card move on once the Mac has run it.
// Whether to: the account has a paired browser with a passkey (public.devices; a wrong answer from the server only
// sends an unsigned Allow the Mac refuses, or opens the sign page needlessly), and the ask is one a passkey signs.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import type { GrantScope } from "@/lib/cloud-commands";
import type { CloudCardRow } from "@/lib/cloud-sync-types";
import { SIGN_ORIGIN, signApproveUrl } from "@/lib/sign-origin";
import { needsPasskey } from "@/lib/web-passkey-approval";

const signOrigin = () => process.env.NEXT_PUBLIC_WEFT_SIGN_ORIGIN || SIGN_ORIGIN;

export function useSignWindow(client: SupabaseClient) {
  const [hasPasskey, setHasPasskey] = useState(false);
  useEffect(() => {
    let live = true;
    void client
      .from("devices")
      .select("passkey_id, revoked_at")
      .eq("kind", "browser")
      .then(({ data }) => {
        const rows = (data ?? []) as { passkey_id: string | null; revoked_at: string | null }[];
        if (live) setHasPasskey(rows.some((d) => d.passkey_id && !d.revoked_at));
      });
    return () => {
      live = false;
    };
  }, [client]);
  const needs = useCallback((row: CloudCardRow, allow: boolean, grant?: GrantScope) => hasPasskey && needsPasskey(row, allow, grant), [hasPasskey]);
  const open = useCallback((row: CloudCardRow) => {
    const pendingId = row.card.pending?.id;
    if (pendingId) window.open(signApproveUrl(signOrigin(), row.card_id, pendingId), "_blank", "noopener,noreferrer");
  }, []);
  return { needs, open };
}
