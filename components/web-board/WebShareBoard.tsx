"use client";

// Share on the weft.zip board's header (the desktop's BoardHeader, variant="web"): the same Share the board dialog as the desktop's
// (components/BoardSharePanel.tsx), on the visitor's own cookie session. The team loads when the dialog opens, through
// the boardShareTeam server action, and invites go through the team page's server actions (components/team/web-actions.ts),
// so an address with a Weft account joins at once and any other gets an invite email to sign up and join.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { CopyLinkButton, ShareDialog } from "@aimhuge/share/client";
import { boardShareTeam } from "@/lib/team-actions";
import type { TeamClientActions } from "@/lib/team-types";
import type { TeamHookState } from "@/lib/use-team";
import { BoardShareBody, boardUrl } from "../BoardSharePanel";
import Icon from "../Icon";
import { webTeamActions } from "../team/web-actions";

type Loaded = Exclude<TeamHookState, { kind: "signed-out" }>;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The team for one workspace, and actions that reload it after a change so a new invite shows in the list.
function useWebTeam(orgSlug: string) {
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    boardShareTeam(orgSlug).then(
      (team) => live && setState({ kind: "ok", team }),
      (err: unknown) => live && setState({ kind: "error", message: message(err) }),
    );
    return () => {
      live = false;
    };
  }, [orgSlug, reload]);

  const base = webTeamActions(orgSlug);
  const actions: TeamClientActions = {
    ...base,
    invite: async (email, role) => {
      const result = await base.invite(email, role);
      if (result.ok) refresh();
      return result;
    },
  };
  return { state, refresh, actions };
}

function WebShareDialog({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const router = useRouter();
  const [org, setOrg] = useState(orgSlug);
  const { state, refresh, actions } = useWebTeam(org);
  const url = boardUrl(state.kind === "ok" ? state.team.org.slug : org);
  return createPortal(
    <ShareDialog
      title="Share the board"
      onClose={onClose}
      headerAction={<CopyLinkButton size="sm" url={url} />}
      footerStart={<CopyLinkButton url={url} />}
    >
      <BoardShareBody
        state={state}
        refresh={refresh}
        actions={actions}
        onSwitch={setOrg}
        onManageTeam={() => router.push(`/${org}/team`)}
      />
    </ShareDialog>,
    document.body,
  );
}

export function WebShareBoard({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Share the board"
        className="flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken"
      >
        <Icon name="share" size={14} /> Share
      </button>
      {open && <WebShareDialog orgSlug={orgSlug} onClose={() => setOpen(false)} />}
    </>
  );
}
