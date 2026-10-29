"use client";

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CopyLinkButton, ShareAccessFields, ShareDialog, useShareAccess, type SaveShareAccess } from "@aimhuge/share/client";
import { api } from "@/lib/client";
import { useOverlay } from "@/lib/overlay";
import { isCardShareMode, seedShareState, type CardShareState } from "@/lib/share-types";
import type { Card } from "@/lib/types";
import { useAccount } from "@/lib/use-account";
import { useEscape } from "@/lib/use-escape";
import Icon, { Spinner } from "./Icon";
import { errorText, NoWorkspace, SHARE_BUTTON, ShareNote, SignedOut } from "./ShareParts";
import { ShareCardOptions } from "./ShareCardOptions";

// Share… (the card's right-click menu): one weft.zip link that shows this thread and its browser pane, live,
// behind one of @aimhuge/share's modes (never editing: that would run turns on this Mac). The link reads the
// card from cloud sync, so until the card is on Supabase the dialog says why and offers the next step
// (lib/card-share.ts answers the state). It never waits on that answer (~2 s): it draws at once from the share the
// card remembers (card.share, else private) and the answer replaces it. The package's dialog draws the frame and closes on Escape itself.
// It goes to document.body, centered over the whole window, and counts as an overlay so the browser pane (a native
// view drawn above the page) steps aside while it's open.
const POLL_MS = 2000;

function hydrateFrom(state: CardShareState, hydrate: ReturnType<typeof useShareAccess>["hydrate"]) {
  if (state.kind === "ok") hydrate({ shareMode: state.mode, editRequiresEmail: false, hasPassword: state.hasPassword });
}

export default function ShareCardDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const account = useAccount();
  const userId = account.state.kind === "ready" ? account.state.view.user?.id : undefined;
  const signedOut = account.state.kind === "ready" && !userId;
  const [state, setState] = useState<CardShareState>(() => seedShareState(card, signedOut));
  const [error, setError] = useState<string | null>(null);

  // The package's ShareDialog listens for Escape on its own. This layer only keeps Weft's own (the open thread,
  // the browser, a drawer under it) from also closing, so one Escape closes just the dialog.
  useEscape(true, () => {});
  useOverlay(true);

  const save: SaveShareAccess = async (next, password) => {
    if (!isCardShareMode(next.mode)) return { ok: false, error: "Threads can't be edited from a link." };
    try {
      const answer = await api.setShare(card.id, { mode: next.mode, password });
      setState(answer);
      return answer.kind === "ok" ? { ok: true } : { ok: false, error: "Sharing isn't available right now." };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  };
  const access = useShareAccess({ save });
  const { hydrate } = access;

  // The seed's fields before the first paint, so the dialog never opens empty.
  useLayoutEffect(() => hydrateFrom(state, hydrate), []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      const answer = await api.getShare(card.id);
      setState(answer);
      setError(null);
      hydrateFrom(answer, hydrate);
    } catch (err) {
      setError(errorText(err));
    }
  }, [card.id, hydrate]);

  // On open, and again once you sign in from here.
  useEffect(() => {
    const ask = () => void load();
    ask();
  }, [load, userId]);

  // The outbox flushes within seconds; ask again until the card's row is up.
  useEffect(() => {
    if (state.kind !== "pending") return;
    const timer = setTimeout(() => void load(), POLL_MS);
    return () => clearTimeout(timer);
  }, [state, load]);

  // Settings → Sync's switch for the card's folder (it also queues the folder's cards), then ask again.
  async function turnOnSync(folder: string) {
    try {
      await api.cloudSyncSetFolder(folder, true);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const url = state.kind === "ok" ? state.url : null;
  return createPortal(
    <ShareDialog
      title={`Share “${card.title}”`}
      onClose={onClose}
      headerAction={url ? <CopyLinkButton size="sm" url={url} /> : undefined}
      footerStart={url ? <CopyLinkButton url={url} /> : undefined}
    >
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : (
        <ShareBody
          state={state}
          access={access}
          account={account}
          onSyncOn={turnOnSync}
          options={state.kind === "ok" ? <ShareCardOptions cardId={card.id} state={state} setState={setState} setError={setError} /> : null}
        />
      )}
    </ShareDialog>,
    document.body,
  );
}

function ShareBody({
  state,
  access,
  account,
  onSyncOn,
  options,
}: {
  state: CardShareState;
  access: ReturnType<typeof useShareAccess>;
  account: ReturnType<typeof useAccount>;
  onSyncOn: (folder: string) => Promise<void>;
  options: ReactNode;
}) {
  switch (state.kind) {
    case "ok":
      return (
        <>
          <ShareAccessFields s={access} noun="thread" allowEdit={false} />
          {options}
          <p className="mt-3 text-[12px] leading-snug text-muted">
            The link is live. Key-shaped text is masked and long tool outputs stay on your Mac.
          </p>
        </>
      );
    case "not-synced":
      return <NotSynced folder={state.folder} onSyncOn={onSyncOn} />;
    case "pending":
      return (
        <ShareNote>
          <Spinner size={13} /> Uploading this card…
        </ShareNote>
      );
    case "signed-out":
      return <SignedOut account={account} />;
    case "no-workspace":
      return <NoWorkspace />;
  }
}

function NotSynced({ folder, onSyncOn }: { folder: string; onSyncOn: (folder: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const name = folder.split("/").filter(Boolean).pop() ?? folder;
  return (
    <div className="space-y-2 text-[13px] text-ink">
      <p>A share link reads the card from cloud sync, and this folder doesn&apos;t sync yet.</p>
      <p className="text-[12px] leading-snug text-muted">
        Turning it on uploads every thread in {folder} to your workspace. Thread text is uploaded unencrypted for now: turn it on only
        for projects you&apos;re fine storing on Weft&apos;s servers.
      </p>
      <button
        type="button"
        disabled={busy}
        className={SHARE_BUTTON}
        onClick={() => {
          setBusy(true);
          void onSyncOn(folder).finally(() => setBusy(false));
        }}
      >
        {busy ? <Spinner size={13} /> : <Icon name="globe" size={14} />}
        Turn on sync for {name}
      </button>
    </div>
  );
}
