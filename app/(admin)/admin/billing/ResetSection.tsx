"use client";

// Reset a workspace's billing state: clear its Stripe ids so the next checkout starts fresh. For sandbox ids on a real
// workspace (a dev run on the shared Supabase), purging the mirrored invoices and cards is ticked by default.

import { useState } from "react";
import { ui } from "./admin-api";
import type { OrgDetail, RunOp } from "./org-types";

export default function ResetSection({ detail, run }: { detail: OrgDetail; run: RunOp }) {
  const sandbox = detail.mode.mode === "test";
  const [cancelUpstream, setCancel] = useState(true);
  const [purgeMirror, setPurge] = useState(sandbox);
  if (detail.mode.mode === "none") return null;
  return (
    <section className={`${ui.card} border-red-400/40`}>
      <h2 className={ui.h}>Reset billing state</h2>
      <p className="text-xs text-admin-muted">
        Clears the customer and subscription ids and puts the workspace on Free. The old ids stay in the audit log.
        {sandbox && " These are sandbox ids: a live checkout would trip on them."}
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={cancelUpstream} onChange={(e) => setCancel(e.target.checked)} /> Cancel the subscription in Stripe first
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={purgeMirror} onChange={(e) => setPurge(e.target.checked)} /> Delete the mirrored Stripe invoices and cards
      </label>
      <div>
        <button type="button" className={ui.danger} onClick={() => void run("reset", { cancelUpstream, purgeMirror }, `Reset ${detail.org.slug}'s billing?`)}>
          Reset billing
        </button>
      </div>
    </section>
  );
}
