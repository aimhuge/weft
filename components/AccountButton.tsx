"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAccount } from "@/lib/use-account";
import { useEscape } from "@/lib/use-escape";
import { useTeamPrefetch } from "@/lib/use-team";
import { REPLAY_EVENT } from "@/lib/welcome-client";
import { openTeamPage } from "./board-palette";
import Avatar from "./Avatar";
import Icon, { Spinner } from "./Icon";

function signedInId(state: ReturnType<typeof useAccount>["state"]): string | undefined {
  return state.kind === "ready" ? state.view.user?.id : undefined;
}

// The top bar's account control, right of Copilot. Signed out: "Sign in" with GitHub, which finishes in
// your browser. Signed in: a share icon (Share the board) and your avatar, which opens a tiny menu (Settings, Share the
// board, Your team, Replay the welcome). Hidden while
// loading, on errors, and in builds without a Supabase key, so it never costs header room for nothing.
export default function AccountButton({ onOpenSettings, onShareBoard }: { onOpenSettings: () => void; onShareBoard?: () => void }) {
  const { state, busy, waiting, error, signIn } = useAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEscape(menuOpen, () => setMenuOpen(false));
  useTeamPrefetch(signedInId(state));
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
          className="rounded-full p-0.5 hover:bg-sunken"
        >
          <Avatar user={user} size={24} />
        </button>
        {menuOpen && (
          <div
            id={menuId}
            role="menu"
            className="absolute right-0 top-full z-40 mt-1.5 w-[220px] rounded-lg border border-line bg-panel p-1 shadow-lg"
          >
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onOpenSettings();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-sunken"
            >
              <Icon name="sliders" size={14} className="text-muted" />
              Settings…
            </button>
            {onShareBoard && (
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onShareBoard();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-sunken"
              >
                <Icon name="share" size={14} className="text-muted" />
                Share the board…
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                openTeamPage();
              }}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-sunken"
            >
              <span className="flex w-full items-center gap-2 text-[13px] text-ink">
                <Icon name="globe" size={14} className="text-muted" />
                Your team
              </span>
              <span className="pl-6 text-[11.5px] leading-snug text-muted">Invite teammates on weft.zip</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                window.dispatchEvent(new Event(REPLAY_EVENT));
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-sunken"
            >
              <Icon name="play" size={14} className="text-muted" />
              Replay the welcome
            </button>
          </div>
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
