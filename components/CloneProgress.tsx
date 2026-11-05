"use client";

import { useCloneProgress } from "@/lib/use-clone-progress";

// The clone of fullName as a progress bar with git's phase under it ("Receiving objects · 1.2 MiB | 2.3 MiB/s  45%"),
// polled while it's mounted; the picker and the project menu mount it only while their clone runs.
export default function CloneProgress({ fullName }: { fullName: string }) {
  const job = useCloneProgress(fullName);
  const percent = job?.percent ?? 0;
  return (
    <span className="flex w-full flex-col gap-1" role="progressbar" aria-label={`Cloning ${fullName}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <span className="block h-1 w-full overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(3, percent)}%` }} />
      </span>
      <span className="flex justify-between gap-2 text-[10.5px] text-muted">
        <span className="truncate">{job?.line ?? "Starting…"}</span>
        <span className="shrink-0 tabular-nums">{percent}%</span>
      </span>
    </span>
  );
}
