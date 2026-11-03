"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import type { WorkerProject } from "./worker-project";

// Your Weft Workers' projects, read once while a page is open (Settings → Agents lists them beside this Mac's, so a
// worker project gets a default agent too). The board's own polling read is lib/use-worker-board.ts; this is one
// request, and none of yours (signed out, no worker) reads as an empty list.
export function useWorkerProjectsOnce(): WorkerProject[] {
  const [projects, setProjects] = useState<WorkerProject[]>([]);
  useEffect(() => {
    let live = true;
    apiFetch("/api/worker-board")
      .then((res) => (res.ok ? (res.json() as Promise<{ projects?: WorkerProject[] }>) : { projects: [] }))
      .then((board) => live && setProjects(board.projects ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return projects;
}
