"use client";

import { useEffect, useRef, useState } from "react";
import { APP_SLUG_RE, type AppOwner, type AppShareState } from "@/lib/app-share-types";
import { defaultAppSlug } from "@/lib/app-share-slug";
import type { MiniApp } from "@/lib/mini-apps";
import { isCardShareMode } from "@/lib/share-types";
import { appsApi, reloadApps } from "@/lib/use-mini-apps";
import { errorText } from "./ShareParts";

// One row: "Under [@<user> ▾] / apps / [slug]" — the owner dropdown and the slug field, saved together on
// blur or Enter. The default slug (lib/app-share-slug.ts defaultAppSlug) is the one the server gives a link
// that has none yet. The server validates with APP_SLUG_RE and turns a unique-index violation
// into "That address is taken." (lib/app-share.ts isDuplicateSlug). Split out from ShareAppDialog.tsx
// so the dialog stays under the 300-line cap (SOUL.md's ratchet).
export function OwnerSlugRow({
  state,
  app,
  setState,
  setError,
}: {
  state: Extract<AppShareState, { kind: "ok" }>;
  app: MiniApp;
  setState: (s: AppShareState) => void;
  setError: (e: string | null) => void;
}) {
  const defaultSlug = defaultAppSlug(app);
  const owners = state.owners;
  const canPickOrg = owners.orgs.length > 0;
  const [draftSlug, setDraftSlug] = useState<string>(state.slug ?? defaultSlug);
  const [draftOwner, setDraftOwner] = useState<"user" | "org">(state.owner ?? "user");
  const [busy, setBusy] = useState(false);

  // Sync drafts with the server's slug/owner for the same share id. Without this, a memo's old
  // slug (an app renamed upstream, a share edited elsewhere) sticks in the input until the user
  // types something; the commit then overwrites the server's slug with the cached one. The key on
  // the parent only remounts this when the id itself changes (a new share, a cleared one); for the
  // same id with a new slug, the effect below syncs the draft instead. The refs hold what we last
  // pulled from the server so a state render where the server's values didn't change isn't seen
  // as an update (which would clobber what the user just typed).
  const lastServerSlug = useRef<string | null>(null);
  const lastServerOwner = useRef<AppOwner | null>(null);
  useEffect(() => {
    const serverSlug = state.slug ?? defaultSlug;
    if (serverSlug !== lastServerSlug.current) {
      lastServerSlug.current = serverSlug;
      setDraftSlug((prev) => (prev === serverSlug ? prev : serverSlug));
    }
    const serverOwner: AppOwner = state.owner ?? "user";
    if (serverOwner !== lastServerOwner.current) {
      lastServerOwner.current = serverOwner;
      setDraftOwner((prev) => (prev === serverOwner ? prev : serverOwner));
    }
  }, [state.id, state.slug, state.owner, defaultSlug]);

  // The org id the dropdown points at today (the new pick before save): stick with what the server said,
  // else the first one the user can pick.
  const currentOrgId = draftOwner === "org" ? (state.orgId && owners.orgs.some((o) => o.id === state.orgId) ? state.orgId : owners.orgs[0]?.id ?? null) : null;

  async function commit() {
    if (busy) return;
    if (!isCardShareMode(state.mode)) return;
    const trimmed = draftSlug.trim();
    if (!APP_SLUG_RE.test(trimmed)) {
      setError("Pick an address of 1 to 40 letters, digits, or hyphens.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const answer = await appsApi.setShare(app.id, buildUpdate(state, trimmed, draftOwner, currentOrgId));
      setState(answer);
      void reloadApps().catch(() => {});
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12.5px]">
      <span className="text-muted">Under</span>
      <select
        value={draftOwner}
        onChange={(e) => setDraftOwner(e.currentTarget.value as "user" | "org")}
        onBlur={() => void commit()}
        disabled={!owners.user && !canPickOrg}
        className="rounded-md border border-line bg-canvas px-2 py-1 text-ink outline-none focus:border-accent disabled:opacity-50"
        aria-label="Owner"
      >
        {owners.user && <option value="user">@{owners.user.username}</option>}
        {canPickOrg && orgList(owners.orgs, currentOrgId).map((o) => <option key={o.id} value="org">{o.slug}</option>)}
      </select>
      <span className="text-muted">/ apps /</span>
      <input
        value={draftSlug}
        onChange={(e) => setDraftSlug(e.currentTarget.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
            e.currentTarget.blur();
          }
        }}
        aria-label="Slug"
        className="w-32 rounded-md border border-line bg-canvas px-2 py-1 text-ink outline-none focus:border-accent"
      />
    </div>
  );
}

// The setShare body: keep the current mode and password, set owner/orgId/slug from the form drafts.
function buildUpdate(
  state: Extract<AppShareState, { kind: "ok" }>,
  slug: string,
  owner: "user" | "org",
  orgId: string | null,
): Parameters<typeof appsApi.setShare>[1] {
  const next: Parameters<typeof appsApi.setShare>[1] = { mode: state.mode };
  if (state.hasPassword) next.password = undefined;
  if (owner === "org") {
    next.owner = "org";
    if (orgId) next.orgId = orgId;
  } else {
    next.owner = "user";
  }
  next.slug = slug;
  return next;
}

function orgList(orgs: { id: string; slug: string; name: string }[], currentOrgId: string | null) {
  // If the current org isn't in the list (the user left it), show it first so its name is visible.
  if (currentOrgId && !orgs.some((o) => o.id === currentOrgId)) return [{ id: currentOrgId, slug: "unknown", name: "Unknown" }, ...orgs];
  return orgs;
}
