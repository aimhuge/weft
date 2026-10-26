"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openInPane } from "./open-in-pane";
import { skillRegistry, type ReviewWhere } from "./skill-registry-client";
import type { RemoteSkill, SkillReviewState, SkillScan } from "./types";

// The ✦ drawer's reach past your own library: skills.sh hits for the filter text, the static scan of every
// skill you have, and AI reviews that open in the pane (docs/architecture/skills.md).

const DEBOUNCE_MS = 400;

// skills.sh hits for a query of two letters or more, a pause after the last keystroke.
export function useSkillSearch(query: string, cwd: string | undefined) {
  const [state, setState] = useState<{ q: string; skills: RemoteSkill[]; error?: string } | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      skillRegistry.search(q, cwd, ctrl.signal).then(
        (r) => setState({ q, skills: r.skills }),
        (err: unknown) => !ctrl.signal.aborted && setState({ q, skills: [], error: err instanceof Error ? err.message : String(err) }),
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, cwd]);
  const current = q.length >= 2 && state?.q === q ? state : null;
  return { skills: current?.skills ?? [], error: current?.error, loading: q.length >= 2 && !current };
}

// The static scan of every skill and plugin in a folder's library, by name.
export function useLibraryScans(cwd: string | undefined, active: boolean) {
  const [scans, setScans] = useState<Record<string, SkillScan>>({});
  const reload = useCallback(() => {
    skillRegistry.scans(cwd).then((r) => setScans(r.scans), () => setScans({}));
  }, [cwd]);
  useEffect(() => {
    if (active) reload();
  }, [active, reload]);
  return { scans, reload };
}

export const fileUrl = (file: string) => `file://${encodeURI(file)}`;

// The AI review of a skill or plugin you have, in the pane: kept if its folder hasn't changed, else started.
export async function openLocalReview(cwd: string | undefined, name: string) {
  const state = await skillRegistry.review({ cwd, name });
  if (state.status !== "none") openInPane(fileUrl(state.page));
}

const POLL_MS = 3000;
const POLL_LIMIT = 100;

// Starts (or reopens) a skill's AI review, shows its page in the pane, and follows it until it ends.
const NONE: SkillReviewState = { status: "none" };

export function useSkillReview(where: ReviewWhere | null, initial: SkillReviewState = NONE) {
  const [state, setState] = useState<SkillReviewState>(initial);
  const polls = useRef(0);
  const key = where ? JSON.stringify(where) : "";
  // A new skill, or a fresh preview of it, starts from what the server said (set while rendering, React's
  // way to reset state on a prop change).
  const stamp = `${key}|${JSON.stringify(initial)}`;
  const [seen, setSeen] = useState(stamp);
  if (seen !== stamp) {
    setSeen(stamp);
    setState(initial);
  }

  useEffect(() => {
    if (state.status !== "running" || !where) return;
    const timer = setTimeout(() => {
      if (++polls.current > POLL_LIMIT) return;
      skillRegistry.reviewState(where).then(setState, () => {});
    }, POLL_MS);
    return () => clearTimeout(timer);
    // `key` stands for `where`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, key]);

  const open = useCallback(async () => {
    if (!where) return;
    polls.current = 0;
    const next = await skillRegistry.review(where);
    setState(next);
    if (next.status !== "none") openInPane(fileUrl(next.page));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { state, open };
}
