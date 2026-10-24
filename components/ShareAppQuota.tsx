// The Share dialog's line on the workspace's room for shared apps (lib/app-share-quota.ts): the bytes its open links
// serve against the plan's cap, or why the latest edits didn't go up. Views are unlimited on every plan.
import { bytesLabel } from "@/lib/billing/plans";
import type { AppShareQuota } from "@/lib/app-share-types";
import { openUpgrade } from "@/lib/use-upgrade";

export function ShareAppQuota({ quota }: { quota: AppShareQuota | null | undefined }) {
  if (!quota) return null;
  if (quota.over) {
    return (
      <p role="alert" className="mt-2 text-[12px] leading-snug text-danger">
        {quota.over} The link still shows the last version that fit.{" "}
        {quota.plan !== "team" && (
            <button type="button" onClick={() => openUpgrade("share-room")} className="font-medium underline hover:opacity-80">
            See plans
          </button>
        )}
      </p>
    );
  }
  return (
    <p className="mt-2 text-[12px] leading-snug text-muted">
      Shared apps: {bytesLabel(quota.used)} of {bytesLabel(quota.cap)} on {quota.planName}. Views are unlimited; private links
      don&apos;t count.
    </p>
  );
}
