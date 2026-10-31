"use client";

import { useState } from "react";
import { useAccount } from "@/lib/use-account";
import { useTeam } from "@/lib/use-team";
import { openTeamPage, openWeftPage } from "./board-palette";
import { BoardShareBody, boardUrl } from "./BoardSharePanel";
import Icon from "./Icon";
import { SHARE_BUTTON, SignedOut } from "./ShareParts";
import WeftShareDialog from "./WeftShareDialog";

// Share the board on the desktop (the share icon by your avatar, its menu, the palette): the workspace's web board at
// weft.zip/<slug>/board with Copy and Open, and the shared panel (components/BoardSharePanel.tsx) for who can open it and
// invites. The team comes from lib/use-team.ts (prefetched by the top bar, so it usually opens loaded). Signed out, it
// asks you to sign in first, like Share…. Same frame and overlay rules as Share….
export { boardUrl };

export default function ShareBoardDialog({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const [org, setOrg] = useState<string | undefined>(undefined);
  const { state, refresh, actions } = useTeam(org);
  const signedOut = account.state.kind === "ready" && !account.state.view.user;

  const url = state.kind === "ok" && !signedOut ? boardUrl(state.team.org.slug) : null;
  return (
    <WeftShareDialog
      title="Share the board"
      url={url}
      onClose={onClose}
      footerExtra={
        url ? (
          <button type="button" className={SHARE_BUTTON} onClick={() => openWeftPage(url)}>
            <Icon name="globe" size={14} /> Open
          </button>
        ) : undefined
      }
    >
      {signedOut || state.kind === "signed-out" ? (
        <SignedOut account={account} />
      ) : (
        <BoardShareBody state={state} refresh={refresh} actions={actions} onSwitch={setOrg} onManageTeam={openTeamPage} />
      )}
    </WeftShareDialog>
  );
}

