"use client";

import { useCallback, useState } from "react";
import { api } from "./client";
import { openIntake } from "./intake-open";
import { readViewPrefs, writeViewPrefs } from "./view-prefs";
import { NO_REVIEW_FILTER, type ReviewFilter, type ReviewFilterKey, type SortKey } from "./board-view";

// The board's project filter and sort order, persisted to a cookie (lib/view-prefs.ts). The cookie
// is read on every (re)connect, not at init, so the server-rendered shell stays cookie-free and the
// first draw doesn't have to wait on `document.cookie`. Picking a different project closes the open
// thread and its browser and clears the card filter so the next card starts clean, and warms that folder's CLI so the next new
// thread doesn't wait on a cold start.
export interface BoardViewDeps {
  select: (id: string | null) => void;
  setWebBrowserOpen: (open: boolean) => void;
}

// A project opened: take in its .env files, the keys its code reads and its webhook routes (lib/project-intake.ts),
// in the background, and show what it took in (components/IntakeDialog.tsx). The server runs it once per folder until
// HEAD or an .env file changes, so the screen comes up the first time and after a change, never on every pick.
function takeIn(folder: string) {
  api
    .intake(folder)
    .then((r) => {
      if (r.text) openIntake(folder, r);
    })
    .catch(() => {}); // best-effort: the 🔐 nudge and Import still work by hand
}

export function useBoardView({ select, setWebBrowserOpen }: BoardViewDeps) {
  const [project, setProject] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("newest");
  // The project bar's card filter; a filter typed for one project rarely fits the next.
  const [query, setQuery] = useState("");
  // Review's Errors and Restart chips; kept for this session only, off again after a reload.
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>(NO_REVIEW_FILTER);
  const toggleReviewFilter = useCallback((key: ReviewFilterKey) => setReviewFilter((f) => ({ ...f, [key]: !f[key] })), []);

  // Reads the cookie once per call. Called from the board's event-stream (re)connect so the saved
  // project and sort come back without blocking the first paint.
  const loadFromPrefs = useCallback(() => {
    const prefs = readViewPrefs();
    if (prefs.project !== undefined) setProject(prefs.project);
    if (prefs.project) takeIn(prefs.project);
    const next = prefs.sort;
    if (next && VALID_SORTS.has(next)) setSort(next);
  }, []);

  // A new project starts clean: close the open thread and its browser, and clear the card filter.
  const chooseProject = useCallback(
    (path: string | null) => {
      if (path !== project) {
        select(null);
        setQuery("");
        if (window.weft) window.weft.browser.setVisible(false);
        else setWebBrowserOpen(false);
      }
      setProject(path);
      writeViewPrefs({ project: path, sort });
      // Have a CLI ready in that folder for the next new thread.
      if (path) api.warm({ cwd: path }).catch(() => {}); // best-effort prefetch
      if (path) takeIn(path);
    },
    [project, sort, select, setWebBrowserOpen],
  );

  const chooseSort = useCallback(
    (next: SortKey) => {
      setSort(next);
      writeViewPrefs({ project, sort: next });
    },
    [project],
  );

  return { project, sort, query, setQuery, chooseProject, chooseSort, loadFromPrefs, reviewFilter, toggleReviewFilter };
}

const VALID_SORTS: ReadonlySet<SortKey> = new Set(["newest", "active", "oldest"]);
