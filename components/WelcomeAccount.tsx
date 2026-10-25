"use client";

import { useState } from "react";
import { useAccount } from "@/lib/use-account";
import Icon, { Spinner } from "./Icon";

// The welcome's sign-in screen (components/WelcomeDialog.tsx), after Get ready's video and before the projects: a new
// Wefter signs in to Weft with GitHub before going on, since the profile, Project Sync, share links, leagues and the
// Puku trial all hang off the account. It only shows when sign-in is set up on this Weft and you're signed out; an
// account that can't be read leaves it out rather than trapping a first launch on a screen that can't be passed.

export function useAccountStep() {
  const { state } = useAccount();
  const view = state.kind === "ready" ? state.view : null;
  const signedIn = Boolean(view?.user);
  // Once it has shown, it stays in the steps, so "Step 2 of 4" doesn't renumber the moment you sign in.
  const [shown, setShown] = useState(false);
  return { needed: Boolean(view?.configured) && (!signedIn || shown), signedIn, show: () => setShown(true) };
}

export function AccountStep() {
  const { state, busy, waiting, error, signIn } = useAccount();
  const user = state.kind === "ready" ? state.view.user : null;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[18px] font-semibold text-ink">Sign in to Weft</h2>
        <p className="text-[12.5px] text-muted">
          Your Weft account is your GitHub. It keeps your Wefter Profile and turns on Project Sync, share links, leagues and
          the free Puku trial.
        </p>
      </div>
      {user ? (
        <p className="flex items-center gap-2 rounded-lg border border-line px-3 py-3 text-[13px] text-ink">
          <span className="text-ok">✓</span> Signed in as <b>{user.name ?? user.email ?? "you"}</b>
        </p>
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-line px-3 py-3">
          <button
            type="button"
            onClick={() => void signIn("github")}
            disabled={busy !== null || waiting !== null}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {waiting ? <Spinner size={13} /> : <Icon name="github" size={15} />}
            {waiting ? "Finish signing in in your browser…" : "Sign in with GitHub"}
          </button>
          {error && <p className="text-[12px] text-danger">{error}</p>}
        </div>
      )}
      <p className="text-[12px] text-muted">Your code and threads stay on this Mac unless you turn on Project Sync for a project.</p>
    </div>
  );
}
