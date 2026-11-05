"use client";

import { useEffect, useState } from "react";
import type { CloneJob } from "./clone-progress-types";
import { api } from "./client";

export const CLONE_POLL_MS = 400;

// The progress of the clone of fullName while it runs (null when nothing is cloning), polled from
// GET /api/repos/clone; the POST that started it answers when it ends, so this only draws the bar.
export function useCloneProgress(fullName: string | null): CloneJob | null {
  const [job, setJob] = useState<CloneJob | null>(null);
  useEffect(() => {
    if (!fullName) return;
    let live = true;
    const load = () =>
      void api
        .cloneProgress(fullName)
        .then((next) => {
          if (live && next?.status === "running") setJob(next);
        })
        .catch(() => {});
    load();
    const poll = setInterval(load, CLONE_POLL_MS);
    return () => {
      live = false;
      clearInterval(poll);
      setJob(null);
    };
  }, [fullName]);
  return fullName ? job : null;
}
