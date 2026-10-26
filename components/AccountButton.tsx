"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAccount } from "@/lib/use-account";
import { useBillingPrefetch } from "@/lib/use-billing-status";
import { avatarPollMs, useCloudSync } from "@/lib/use-cloud-sync";
import { useEscape } from "@/lib/use-escape";
import { useTeamPrefetch } from "@/lib/use-team";
import AccountMenu from "./AccountMenu";
import { SyncDot } from "./AccountSync";
import Avatar from "./Avatar";
import Icon, { Spinner } from "./Icon";

function signedInId(state: ReturnType<typeof useAccount>["state"]): string | undefined {
  return state.kind === "ready" ? state.view.user?.id : undefined;
}

// The top bar's account control, right of Copilot. Signed out: "Sign in" with GitHub, which finishes in
// your browser. Signed in: a share icon (Share the board) and your avatar, which opens a tiny menu
// (components/AccountMenu.tsx), with a dot on it while board sync uploads (amber) or has failed (red). Hidden while
// loading, on errors, and in builds without a Supabase key, so it never costs header room for nothing.
export default function AccountButton({ onOpenSettings, onShareBoard, project = null }: { onOpenSettings: () => void; onShareBoard?: () => void; project?: string | null }) {
  const { state, busy, waiting, error, signIn } = useAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  const signedIn = !!signedInId(state);
  const sync = useCloudSync(signedIn, avatarPollMs(menuOpen));
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEscape(menuOpen, () => setMenuOpen(false));
  useTeamPrefetch(signedInId(state));
  useBillingPrefetch(signedInId(state));
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  if (state.kind !== "ready" || !state.view.configured) return null;

  const user = state.view.user;
  if (user) {
    const who = user.name ?? user.email ?? "your account";
    return (
      <div ref={menuRef} className="relative flex shrink-0 items-center gap-1">
        <ShareBoardIcon onShareBoard={onShareBoard} />
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          title={`Signed in as ${who}`}
          aria-label={`Signed in as ${who}`}
          className="relative rounded-full p-0.5 hover:bg-sunken"
        >
          <Avatar user={user} size={24} />
          <SyncDot status={sync.status} folders={sync.folders} />
        </button>
        {menuOpen && (
          <AccountMenu id={menuId} onClose={() => setMenuOpen(false)} onOpenSettings={onOpenSettings} onShareBoard={onShareBoard} sync={sync} project={project} />
        )}
      </div>
    );
  }

  const pending = busy === "github" || waiting !== null;
  return (
    <button
      onClick={() => void signIn("github")}
      disabled={busy !== null}
      title={error ?? (waiting ? "Finish signing in with GitHub in your browser" : "Sign in with GitHub")}
      aria-label="Sign in with GitHub"
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] disabled:opacity-60 ${error ? "border-danger text-danger" : "border-line-strong text-ink hover:bg-sunken"}`}
    >
      {pending ? <Spinner size={13} /> : <Icon name="github" size={14} />}
      {waiting ? "Signing in…" : "Sign in"}
    </button>
  );
}

// One click to Share the board, beside the avatar; nothing when the board doesn't offer it.
function ShareBoardIcon({ onShareBoard }: { onShareBoard?: () => void }) {
  if (!onShareBoard) return null;
  return (
    <button
      onClick={onShareBoard}
      title="Share the board"
      aria-label="Share the board"
      className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink"
    >
      <Icon name="share" size={15} />
    </button>
  );
}
