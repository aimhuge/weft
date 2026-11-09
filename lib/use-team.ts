"use client";

import { upgradeOnGate } from "./use-upgrade";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_HEADERS } from "./api-client";
import { ACCOUNT_EVENT } from "./auth/hooks";
import { cachedTeam, clearTeamCache, loadTeam, warmTeams } from "./team-cache";
import { vaultBridge } from "./vault-view";
import { linkNote, shareLinkedRepo } from "./team-vault-link";
import type { NewTeamOp, NewTeamResult, TeamActionResult, TeamClientActions, TeamOp, TeamSnapshot, VaultRotateResult } from "./team-types";

// The board's view of one workspace on the deployed weft.zip (docs/architecture/teams.md). The desktop's
// local Next server is the only thing that holds the desktop user's access token, so this hook talks to
// /api/account/team, which forwards the call. weft.zip's /api/teams validates the body, so the hook
// doesn't — the action just sends the op with the loaded team's org slug and trusts the answer.

export type TeamHookState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ok"; team: TeamSnapshot };

export { clearTeamCache, prefetchTeam, prefetchTeams } from "./team-cache";

export type TeamHook = {
  state: TeamHookState;
  refresh: () => void;
  actions: TeamClientActions;
};

// The headers the local route needs; x-weft-token is what lib/guard.ts checks on writes.
const WRITE_HEADERS = { ...API_HEADERS, "content-type": "application/json" };

// The desktop's rotate call, when there is a main to make the key in.
//
// The bridge's own type (lib/vault-view.ts) predates the rotate, so the call is read off the window
// directly: an older shell simply has no `rotate`, and the tick then falls through to the server's
// half (the devices are cut off) with no key turned.
function rotateVaults(org: string, userId: string): Promise<VaultRotateResult> | null {
  const bridge = vaultBridge() as { rotate?: (org: string, userId: string) => Promise<VaultRotateResult> } | null;
  if (!bridge?.rotate) return null;
  return bridge.rotate(org, userId);
}

// Have the signed-in account's team ready before anyone opens Settings → Team: the snapshots on disk, then a
// fresh load of the default and the last-picked workspace (lib/team-cache.ts). Signing out or switching account
// forgets the loaded teams. The top bar calls it.
export function useTeamPrefetch(userId: string | undefined): void {
  useEffect(() => {
    clearTeamCache(false);
    if (userId) warmTeams(userId);
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
  const state: TeamHookState = loaded?.org === orgKey ? loaded.state : (cachedTeam(orgKey) ?? { kind: "loading" });

  const current = useRef(orgKey);
  useEffect(() => {
    current.current = orgKey;
  }, [orgKey]);

  useEffect(() => {
    void loadTeam(org, reload > 0).then((next) => {
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
    // A removal with the rotate ticked (docs/architecture/teams-vault.md, "Removal and rotation").
    //
    // The crypto is in Electron main — the new vault key is made there, because that is the only
    // place a vault key exists — so the desktop asks main to rotate *before* the membership is
    // deleted. Main writes the plan to weft.zip; the server then cuts the removed member's devices
    // off and deletes the membership. The names to change at the providers come back to the caller.
    //
    // A shell with no main (the browser on weft.zip) has nothing to rotate with, so the tick is
    // passed on and the server does the half it can: the devices are cut off.
    remove: async (userId, rotate = false) => {
      const namesToRotate: string[] = [];
      if (rotate) {
        const turned = await rotateVaults(state.kind === "ok" ? state.team.org.slug : "", userId);
        if (turned && !turned.ok) return { ok: false, message: turned.error ?? "The shared vaults could not be turned." };
        for (const name of turned?.namesToRotate ?? []) if (!namesToRotate.includes(name)) namesToRotate.push(name);
      }
      const result = await onTeam((org) => ({ org, action: "remove", userId, rotate }));
      return result.ok && namesToRotate.length ? { ok: true, message: `Removed. Turn these at their providers: ${namesToRotate.join(", ")}` } : result;
    },
    revoke: (inviteId) => onTeam((org) => ({ org, action: "revoke", inviteId })),
    // A linked repo's 🔐 vault is the team's: once the link is in, this Mac's vault for it is shared (lib/team-vault-link.ts).
    addProject: async (repo) => {
      const result = await onTeam((org) => ({ org, action: "link-project", repo }));
      if (!result.ok || state.kind !== "ok" || result.message === "Already linked.") return result;
      const { id, name } = state.team.org;
      return { ...result, message: linkNote(repo, name, await shareLinkedRepo(id, name, repo)) };
    },
    removeProject: (repo) => onTeam((org) => ({ org, action: "unlink-project", repo })),
    setProjectAccess: (repo, userId, grant) => onTeam((org) => ({ org, action: "project-access", repo, userId, grant })),
    // A new, renamed or deleted workspace changes every cached snapshot's `orgs` list, so forget them all before the refresh.
    createTeam: (name, slug) => postOp(slug ? { action: "create", name, slug } : { action: "create", name }).then(refreshAll),
    renameTeam: (slug, name) => postOp({ org: slug, action: "rename", name }).then(refreshAll),
    deleteTeam: (slug, confirm) => postOp({ org: slug, action: "delete", confirm }).then(refreshAll),
  };

  return { state, refresh, actions };
}
