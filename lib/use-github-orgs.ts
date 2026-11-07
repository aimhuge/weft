"use client";

import { useEffect, useState } from "react";
import { call } from "./client-api";
import type { GithubOrg, GithubOrgsResult } from "./github-orgs";

// Your GitHub orgs (GET /api/github/orgs) for Settings → Teams: "New team" offers them as names, and a team whose
// slug is one of them gets that org's repos suggested as projects (useOrgRepos). Loaded once a session and kept
// here, so reopening Settings shows them at once; a failure is no orgs, since a team doesn't need one.
let lastOrgs: GithubOrg[] | null = null;
const lastRepos = new Map<string, string[]>();

// Forget what's kept (tests).
export function clearGithubOrgs() {
  lastOrgs = null;
  lastRepos.clear();
}

export function useGithubOrgs(active: boolean): GithubOrg[] {
  const [orgs, setOrgs] = useState<GithubOrg[]>(lastOrgs ?? []);
  useEffect(() => {
    if (!active || lastOrgs) return;
    let live = true;
    call<GithubOrgsResult>("GET", "/api/github/orgs")
      .then((r) => {
        lastOrgs = r.orgs;
        if (live) setOrgs(r.orgs);
      })
      .catch(() => {
        if (live) setOrgs([]);
      });
    return () => {
      live = false;
    };
  }, [active]);
  return orgs;
}

// The repos of the team's own GitHub org (null for none), kept per org; a bump re-reads the kept list once it lands.
export function useOrgRepos(org: string | null): string[] {
  const [, setLanded] = useState(0);
  useEffect(() => {
    if (!org || lastRepos.has(org)) return;
    let live = true;
    // A failure suggests nothing and isn't kept, so the next open asks again.
    call<{ repos: string[] }>("GET", `/api/github/orgs?org=${encodeURIComponent(org)}`).then(
      (r) => {
        lastRepos.set(org, r.repos);
        if (live) setLanded((n) => n + 1);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [org]);
  return (org && lastRepos.get(org)) || [];
}
