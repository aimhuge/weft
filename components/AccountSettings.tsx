"use client";

import { useState } from "react";
import { useUiText } from "@/lib/ui-language";
import { type AccountBusy, type AccountWaiting, PROVIDER_LABELS, useAccount } from "@/lib/use-account";
import { EVERYWHERE_QUESTION } from "@/lib/sign-out-everywhere";
import type { AccountProvider, AccountUser } from "@/lib/types";
import Avatar from "./Avatar";
import BillingStatus from "./BillingStatus";
import { Spinner } from "./Icon";

// How a signed-in user came in, from Supabase's app_metadata.provider.
const PROVIDER_NAMES: Record<string, string> = { ...PROVIDER_LABELS, email: "email" };

const BUTTON =
  "flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

function SignedIn(props: { user: AccountUser; busy: AccountBusy; onSignOut: () => void; onSignOutEverywhere: () => void }) {
  const { user, busy, onSignOut } = props;
  const t = useUiText();
  const label = user.name ?? user.email ?? "?";
  const via = user.provider ? `${t("via")} ${PROVIDER_NAMES[user.provider] ?? user.provider}` : t("Signed in");
  return (
    <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
      <Avatar user={user} size={28} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-ink">{label}</span>
        <span className="truncate text-[12px] text-muted">
          {user.name && user.email ? `${user.email} · ${via}` : via}
        </span>
      </span>
      <button onClick={onSignOut} disabled={busy !== null} className={BUTTON}>
        {busy === "signout" && <Spinner size={11} />}
        {t("Sign out")}
      </button>
      <button
        onClick={() => window.confirm(EVERYWHERE_QUESTION) && props.onSignOutEverywhere()}
        disabled={busy !== null}
        aria-label="Sign out everywhere"
        title="Sign out on every device, this one included: use it if someone else may hold your sign-in"
        className="flex shrink-0 items-center gap-1 text-[12px] text-muted hover:text-danger hover:underline disabled:opacity-50"
      >
        {busy === "signout-everywhere" && <Spinner size={11} />}
        Everywhere
      </button>
    </div>
  );
}

function SignInForm(props: {
  busy: AccountBusy;
  waiting: AccountWaiting | null;
  onProvider: (provider: AccountProvider) => void;
  onEmail: (email: string) => void;
}) {
  const t = useUiText();
  const { busy, waiting } = props;
  const [email, setEmail] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PROVIDER_LABELS) as AccountProvider[]).map((id) => (
          <button key={id} onClick={() => props.onProvider(id)} disabled={busy !== null} className={BUTTON}>
            {busy === id && <Spinner size={11} />}
            {t("Continue with")} {PROVIDER_LABELS[id]}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          props.onEmail(email);
        }}
      >
        <input
          type="email"
          value={email}
          placeholder="you@example.com"
          aria-label={t("Email for a sign-in link")}
          onChange={(e) => setEmail(e.target.value)}
          className="w-[220px] rounded-md border border-line-strong bg-canvas px-2.5 py-1 text-[12.5px] text-ink outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy !== null || !email.trim()} className={BUTTON}>
          {busy === "email" && <Spinner size={11} />}
          {t("Email me a link")}
        </button>
      </form>
      {waiting && (
        <p className="flex items-center gap-2 text-[12.5px] text-muted">
          <Spinner size={11} />
          {waiting.email
            ? `${t("Sent a link to")} ${waiting.what}. ${t("Open it on this Mac to finish.")}`
            : `${t("Finish signing in with")} ${waiting.what} ${t("in your browser.")}`}
        </p>
      )}
    </div>
  );
}

// The Weft account section of Settings. Optional: the board works the same signed out.
export default function AccountSettings({ titleClass, hintClass }: { titleClass: string; hintClass: string }) {
  const t = useUiText();
  const { state, busy, waiting, error, signIn, sendLink, signOut, signOutEverywhere } = useAccount();

  function body() {
    if (state.kind === "loading") {
      return (
        <div className="flex items-center gap-2 py-2 text-[12.5px] text-muted">
          <Spinner size={12} /> {t("Checking your account")}
        </div>
      );
    }
    if (state.kind === "error") {
      return <p className="break-words text-[12.5px] text-danger">{t("Couldn't check your account:")} {state.error}</p>;
    }
    if (!state.view.configured) return <p className="text-[12.5px] text-muted">{t("Sign-in isn't set up in this build yet.")}</p>;
    if (state.view.user) {
      return (
        <SignedIn
          user={state.view.user}
          busy={busy}
          onSignOut={() => void signOut()}
          onSignOutEverywhere={() => void signOutEverywhere()}
        />
      );
    }
    return <SignInForm busy={busy} waiting={waiting} onProvider={(p) => void signIn(p)} onEmail={(e) => void sendLink(e)} />;
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className={titleClass} data-settings-section="Weft account">{t("Weft account")}</h3>
        <p className={hintClass}>{t("Optional. Signing in turns on cloud features like page sync and share links.")}</p>
      </div>
      {body()}
      {state.kind !== "loading" && state.kind !== "error" && state.view.configured && state.view.user && <BillingStatus />}
      {error && <p className="break-words text-[12.5px] text-danger">{error}</p>}
    </section>
  );
}
