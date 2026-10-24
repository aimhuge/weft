"use client";

// Reset a workspace's billing state: clear its Stripe ids so the next checkout starts fresh. For sandbox ids on a real
// workspace (a dev run on the shared Supabase), purging the mirrored invoices and cards is ticked by default.

import { useState } from "react";
import { Button, Checkbox, Section } from "@/components/admin/kit";
import type { OrgDetail, RunOp } from "./org-types";

export default function ResetSection({ detail, run }: { detail: OrgDetail; run: RunOp }) {
  const sandbox = detail.mode.mode === "test";
  const [cancelUpstream, setCancel] = useState(true);
  const [purgeMirror, setPurge] = useState(sandbox);
  if (detail.mode.mode === "none") return null;
  return (
    <Section
      tone="danger"
      title="Reset billing state"
      note="Clears the customer and subscription ids and puts the workspace on Free. The old ids stay in the audit log."
    >
      {sandbox && (
        <p className="text-[12.5px] text-warn">These are sandbox ids: a live checkout would trip on them.</p>
      )}
      <Checkbox label="Cancel the subscription in Stripe first" checked={cancelUpstream} onChange={setCancel} />
      <Checkbox label="Delete the mirrored Stripe invoices and cards" checked={purgeMirror} onChange={setPurge} />
      <div>
        <Button
          variant="danger"
          onClick={() => void run("reset", { cancelUpstream, purgeMirror }, `Reset ${detail.org.slug}'s billing?`)}
        >
          Reset billing
        </Button>
      </div>
    </Section>
  );
}
