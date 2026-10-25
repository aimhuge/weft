"use client";

import { upgradeOnGate } from "./use-upgrade";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_HEADERS, apiFetch } from "./api-client";
import { ACCOUNT_EVENT } from "./auth/hooks";
import type { NewTeamOp, NewTeamResult, TeamActionResult, TeamClientActions, TeamOp, TeamSnapshot } from "./team-types";

// The board's view of one workspace on the deployed weft.zip (docs/architecture/teams.md). The desktop's
// local Next server is the only thing that holds the desktop user's access token, so this hook talks to
// /api/account/team, which forwards the call. weft.zip's /api/teams validates the body, so the hook
// doesn't — the action just sends the op with the loaded team's org slug and trusts the answer.

export type TeamHookState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ok"; team: TeamSnapshot };

export type TeamHook = {
  state: TeamHookState;
  refresh: () => void;
  actions: TeamClientActions;
};

// The headers the local route needs; x-weft-token is what lib/guard.ts checks on writes.
const WRITE_HEADERS = { ...API_HEADERS, "content-type": "application/json" };

// We can't read the status from the typed `api` client (it throws on non-2xx), so the hook asks the
// server directly and maps the status to a state. The forwarder has already turned a fetch error into
// a 502 { error: "offline" } reply, so a 502 here is "we couldn't reach weft.zip".
async function fetchTeam(org: string | undefined): Promise<{ state: Exclude<TeamHookState, { kind: "loading" }> }> {
  const query = org ? `?org=${encodeURIComponent(org)}` : "";
  let res: Response;
  try {
    res = await apiFetch(`/api/account/team${query}`, { method: "GET" });
  } catch {
    return { state: { kind: "error", message: "Couldn't reach weft.zip." } };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: unknown } & Partial<TeamSnapshot>;
  if (res.status === 401) return { state: { kind: "signed-out" } };
  if (res.status === 404) return { state: { kind: "error", message: "No workspace found." } };
  if (res.status === 502) return { state: { kind: "error", message: "Couldn't reach weft.zip." } };
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : `Weft's team API answered ${res.status}.`;
    return { state: { kind: "error", message } };
  }
  // The 2xx path: weft.zip's /api/teams is the only producer of TeamSnapshot the board reads, so a
  // structurally wrong reply is the deployer's problem; we still try to render what we got.
  return { state: { kind: "ok", team: body as TeamSnapshot } };
}

type Loaded = Exclude<TeamHookState, { kind: "loading" }>;

// The last answer per workspace ("" is your default one), so Settings → Team opens on it while a fresh one
// loads. prefetchTeam fills it before the page is ever opened: the top bar calls it once you're signed in.
const cache = new Map<string, Loaded>();
const inflight = new Map<string, Promise<Loaded>>();

// A fetch that lands in the cache. A first load joins a prefetch already on its way; a refresh (after an
// action, a sign-in) always asks again, so it can't come back with an answer from before the change.
function load(org: string | undefined, fresh: boolean): Promise<Loaded> {
  const key = org ?? "";
  const running = inflight.get(key);
  if (running && !fresh) return running;
  const next = fetchTeam(org).then(({ state }) => {
    cache.set(key, state);
    return state;
  });
  inflight.set(key, next);
  void next.finally(() => {
    if (inflight.get(key) === next) inflight.delete(key);
  });
  return next;
}

// Load a workspace's team ahead of time, unless it's already loaded or loading.
export function prefetchTeam(org?: string): void {
  if (cache.get(org ?? "")?.kind === "ok") return;
  void load(org, false);
}

// Forget every loaded team: on sign-out, or a switch to another account.
export function clearTeamCache(): void {
  cache.clear();
  inflight.clear();
}

// Have the signed-in account's team ready before anyone opens Settings → Team: prefetch it for this
// user id, and forget the cache on sign-out or a switch to another account. The top bar calls it.
export function useTeamPrefetch(userId: string | undefined): void {
  useEffect(() => {
    clearTeamCache();
    if (userId) prefetchTeam();
  }, [userId]);
}

// One action: POST a TeamOp with the loaded org's slug, then refresh. Called from the team UI, so a
// failure with a clear message is what the form shows. A 401 inside an action means the user signed
// out between the load and the click; we return an error so the form can say so.
async function postOp(op: TeamOp | NewTeamOp): Promise<NewTeamResult> {
  let res: Response;
  try {
    res = await fetch("/api/account/team", { method: "POST", headers: WRITE_HEADERS, body: JSON.stringify(op) });
  } catch {
    return { ok: false, message: "Couldn't reach weft.zip." };
  }
  const body = (await res.json().catch(() => ({}))) as NewTeamResult & { error?: unknown };
  if (res.status === 401) return { ok: false, message: "Signed out." };
  if (res.status === 502) return { ok: false, message: "Couldn't reach weft.zip." };
  if (res.status === 404) return { ok: false, message: "No workspace found." };
  // weft.zip refused the body: most likely an action this desktop knows and the deployed Weft doesn't yet.
  if (res.status === 400) return { ok: false, message: "weft.zip didn't accept that. It may not have this Weft's latest version yet." };
  if (!res.ok) {
    return { ok: false, message: typeof body.error === "string" ? body.error : `Team API answered ${res.status}.` };
  }
  // The 2xx body is what weft.zip's POST handler returns; truthy `ok` is the success branch and the
  // action shapes the form's result off it. A payload without `ok` is treated as failure so a broken
  // deployment can't masquerade as success.
  return {
    ok: body.ok,
    message: typeof body.message === "string" ? body.message : undefined,
    ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
  };
}

export function useTeam(org?: string): TeamHook {
  // Bumping this counter tells the load effect to fetch again. The refresh callback and the
  // post-op refresh also bump it.
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  // A result counts for the workspace it was fetched for. Switching workspace reads "loading" straight away;
  // a refresh keeps showing the team it has until the new answer lands, and never throws an answer away, so
  // a burst of refreshes (sign-in events, actions) can't keep a slow load from ever finishing.
  const orgKey = org ?? "";
  const [loaded, setLoaded] = useState<{ org: string; state: TeamHookState } | null>(null);
  const state: TeamHookState = loaded?.org === orgKey ? loaded.state : (cache.get(orgKey) ?? { kind: "loading" });

  const current = useRef(orgKey);
  useEffect(() => {
    current.current = orgKey;
  }, [orgKey]);

  useEffect(() => {
    void load(org, reload > 0).then((next) => {
      // An answer for a workspace you've since switched away from is dropped; any answer for this one is kept.
      if (current.current === orgKey) setLoaded({ org: orgKey, state: next });
    });
  }, [org, orgKey, reload]);

  // The board fires `weft:account` whenever the user signs in or out (lib/auth/hooks.ts). Signing out
  // means the snapshot is no longer ours; signing in means we may now have a fresh one. Either way a
  // reload is the right answer.
  useEffect(() => {
    window.addEventListener(ACCOUNT_EVENT, refresh);
    return () => window.removeEventListener(ACCOUNT_EVENT, refresh);
  }, [refresh]);

  // An action that needs a loaded team but doesn't have one still returns a TeamActionResult; the
  // form just shows the message. The UI hides the buttons in those states anyway, but the type
  // stays a single TeamClientActions shape so the components don't have to branch.
  const noTeamMessage: TeamActionResult = { ok: false, message: "Load a workspace first." };
  // Same body as `refresh`; kept under another name so the action handlers read like actions.
  const trigger = refresh;

  // Every op on the loaded workspace: post it, and refresh when it worked.
  const onTeam = (build: (org: string) => TeamOp): Promise<TeamActionResult> => {
    if (state.kind !== "ok") return Promise.resolve(noTeamMessage);
    return postOp(build(state.team.org.slug)).then((r) => {
      if (r.ok) trigger();
      return r;
    });
  };

  const refreshAll = <R extends TeamActionResult>(r: R): R => {
    if (r.ok) {
      clearTeamCache();
      trigger();
    }
    return r;
  };

  const actions: TeamClientActions = {
    // A paywall's refusal (an invite on Free) also opens the upgrade dialog.
    invite: (email, role) => onTeam((org) => ({ org, action: "invite", email, role })).then(upgradeOnGate),
    changeRole: (userId, role) => onTeam((org) => ({ org, action: "role", userId, role })),
    remove: (userId) => onTeam((org) => ({ org, action: "remove", userId })),
    revoke: (inviteId) => onTeam((org) => ({ org, action: "revoke", inviteId })),
    addProject: (repo) => onTeam((org) => ({ org, action: "link-project", repo })),
    removeProject: (repo) => onTeam((org) => ({ org, action: "unlink-project", repo })),
    setProjectAccess: (repo, userId, grant) => onTeam((org) => ({ org, action: "project-access", repo, userId, grant })),
    // A new, renamed or deleted workspace changes every cached snapshot's `orgs` list, so forget them all before the refresh.
    createTeam: (name) => postOp({ action: "create", name }).then(refreshAll),
    renameTeam: (slug, name) => postOp({ org: slug, action: "rename", name }).then(refreshAll),
    deleteTeam: (slug, confirm) => postOp({ org: slug, action: "delete", confirm }).then(refreshAll),
  };

  return { state, refresh, actions };
}
