"use client";

import { snapshotAge, useSnapshotView } from "@/lib/project-snapshot-view";
import { useNow } from "@/lib/use-now";
import Tip from "./Tip";

// Before a worker project's badges: how old their snapshot is, shown only when it's stale or the worker is offline
// ("12m ago, m1mini offline"), so a number the worker measured a while back doesn't pass for a live one.
export default function SnapshotAge({ project, refresh }: { project: string; refresh?: unknown }) {
  const view = useSnapshotView(project, refresh);
  const now = useNow();
  const age = snapshotAge(view, now);
  if (!view || !age) return null;
  return (
    <Tip text={`What ${view.worker} last measured for this project: code quality, the uncommitted pile and the Backlog.`}>
      <span className="px-1 text-[11.5px] text-faint">{age}</span>
    </Tip>
  );
}
