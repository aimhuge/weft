"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ShareAccessFields, useShareAccess, type SaveShareAccess } from "@aimhuge/share/client";
import { seedAppShareState, type AppShareState } from "@/lib/app-share-types";
import type { MiniApp } from "@/lib/mini-apps";
import { isCardShareMode } from "@/lib/share-types";
import { useAccount } from "@/lib/use-account";
import { appsApi, reloadApps } from "@/lib/use-mini-apps";
import { OwnerSlugRow } from "./ShareAppDialogOwnerSlug";
import { UploadSecretsButton } from "./ShareAppDialogUploadSecrets";
import WeftShareDialog from "./WeftShareDialog";
import { ShareAppPreview } from "./ShareAppPreview";
import { ShareAppQuota } from "./ShareAppQuota";
import { errorText, NoWorkspace, ShareNote, SignedOut } from "./ShareParts";

// Share… on a mini app (its right-click menu on the rail, its share button in My mini apps, the pane's
// Share button in components/AppShareButton.tsx): one weft.zip link under the link's owner
// (weft.zip/@<user>/apps/<slug> or weft.zip/<org>/apps/<slug>, lib/app-share-types.ts appPublicUrl) that
// shows the app's page, behind the same @aimhuge/share modes as a card (never editing). lib/app-share.ts
// answers the state: a local page goes up as a copy, a public https site is framed as is, a whole folder
// (lib/app-folder.ts) goes up file by file, and a page only this Mac reaches says why it can't be shared.
// Like the card's dialog it never waits: it draws from the share the app remembers (app.share) and the
// answer replaces it, goes to document.body over the whole window, and steps the native browser pane aside.

// A mini app with no link yet gets one as Share… opens, open to anyone with the link: sharing is why the dialog
// was opened, and Only you is one click away. A folder app's keys go up in the same request, and again on any later
// open when they changed (lib/app-share-keys.ts). A refusal (the plan's room for shared apps, say) leaves the unshared
// answer, and picking a mode shows why.
async function withFirstLink(appId: string, answer: AppShareState): Promise<AppShareState> {
  if (answer.kind !== "ok" || answer.id !== null) return answer;
  try {
    const shared = await appsApi.setShare(appId, { mode: "public" });
    void reloadApps().catch(() => {}); // My mini apps marks the shared ones
    return shared;
  } catch {
    return answer;
  }
}

function hydrateFrom(state: AppShareState, hydrate: ReturnType<typeof useShareAccess>["hydrate"]) {
  if (state.kind === "ok") hydrate({ shareMode: state.mode, editRequiresEmail: false, hasPassword: state.hasPassword });
}

export default function ShareAppDialog({ app, onClose }: { app: MiniApp; onClose: () => void }) {
  const account = useAccount();
  const userId = account.state.kind === "ready" ? account.state.view.user?.id : undefined;
  const signedOut = account.state.kind === "ready" && !userId;
  const [state, setState] = useState<AppShareState>(() => seedAppShareState(app, signedOut));
  const [error, setError] = useState<string | null>(null);


  const save: SaveShareAccess = async (next, password) => {
    if (!isCardShareMode(next.mode)) return { ok: false, error: "Mini apps can't be edited from a link." };
    try {
      const answer = await appsApi.setShare(app.id, { mode: next.mode, password });
      setState(answer);
      void reloadApps().catch(() => {}); // My mini apps marks the shared ones
      return answer.kind === "ok" ? { ok: true } : { ok: false, error: "Sharing isn't available right now." };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  };
  const access = useShareAccess({ save });
  const { hydrate } = access;

  useLayoutEffect(() => hydrateFrom(state, hydrate), []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      const answer = await withFirstLink(app.id, await appsApi.getShare(app.id));
      setState(answer);
      setError(null);
      hydrateFrom(answer, hydrate);
    } catch (err) {
      setError(errorText(err));
    }
  }, [app.id, hydrate]);

  // On open, and again once you sign in from here.
  useEffect(() => {
    const ask = () => void load();
    ask();
  }, [load, userId]);

  // The public URL once the link has both an owner and a slug; the public address is the only one worth
  // showing, so the copy buttons point at it (not the bare /a/<id> for the link's old self). Fall back to
  // the bare /a/<id> for the first paint before the owner and slug land, so the dialog still has a copy.
  const copyUrl = state.kind === "ok" ? state.publicUrl ?? state.url : null;
  return (
    <WeftShareDialog title={`Share “${app.name}”`} url={copyUrl} onClose={onClose}>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : (
        <AppShareBody state={state} app={app} access={access} account={account} setState={setState} setError={setError} />
      )}
    </WeftShareDialog>
  );
}

// The dialog body: the owner's choice and slug (one row, saved on blur or Enter), then the @aimhuge/share
// access fields, then the small "Upload secrets" button when the manifest declares author secrets or
// public names, with what happened to the keys when this answer made the link (they go up with it). The owner/slug saves ride on a separate appsApi.setShare call; the access fields save
// through the package's save (SaveShareAccess) above. Both update the state and the apps list.
function AppShareBody({
  state,
  app,
  access,
  account,
  setState,
  setError,
}: {
  state: AppShareState;
  app: MiniApp;
  access: ReturnType<typeof useShareAccess>;
  account: ReturnType<typeof useAccount>;
  setState: (s: AppShareState) => void;
  setError: (e: string | null) => void;
}) {
  switch (state.kind) {
    case "ok":
      return (
        <>
          {/* key on id when it lands, else on slug when it changes: when the server picks a fresh row id (a new link,
              a cleared one), the form remounts with the server's slug/owner/orgId as the new drafts. The row syncs its
              own drafts when the server's slug changes for the same id (renamed upstream). */}
          <OwnerSlugRow key={state.id ?? state.slug ?? "new"} state={state} app={app} setState={setState} setError={setError} />
          <ShareAccessFields s={access} noun="app" allowEdit={false} />
          <p className="mt-3 text-[12px] leading-snug text-muted">
            {state.shows === "blob"
              ? "The link shows a copy of this page, sandboxed, with key-shaped text masked. Opening Share… again sends your latest edits."
              : state.shows === "folder"
                ? "The link serves every file in this folder, sandboxed, by path. Opening Share… again sends your latest edits, and your keys when they changed."
                : "The link frames this site under weft.zip, with an Open link for sites that refuse to be framed."}
          </p>
          {state.shows === "site" ? null : <ShareAppQuota quota={state.quota} />}
          <ShareAppPreview appId={app.id} name={app.name} state={state} setState={setState} />
          <UploadSecretsButton manifest={state.manifest} appId={app.id} keys={state.keys} />
        </>
      );
    case "unshareable":
      return <ShareNote>{state.reason}</ShareNote>;
    case "signed-out":
      return <SignedOut account={account} />;
    case "no-workspace":
      return <NoWorkspace />;
  }
}
