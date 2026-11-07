"use client";

// The /login form. Mirrors the look of `@aimhuge/auth/client`'s `LoginForm` but
// keeps the GitHub-only requirement (weft's policy: GitHub is the only provider, no magic link on
// the deployed weft.zip). The component is intentionally headless: the only
// button is "Continue with GitHub" and a magic-link row, both optional via
// props. The package's LoginForm would be a drop-in when the upstream tag ships
// — pass `providers={["github"]} providerLabels={{ github: "GitHub" }}`.
//
// On the deployed weft.zip (`deployed: true`) the buttons become plain links
// to /auth/sign-in and the magic-link row hides — the cookie session lives on
// the same origin, so a GET round trip does the whole job without JS. The
// desktop / `next dev` flow keeps the JS-driven `useAuth().signInWithOAuth`
// path that opens the system browser.
import { useState, type SubmitEvent } from "react";
import { api } from "../client";
import { useAuth, type AuthProvider } from "./hooks";

export type LoginFormProps = {
  defaultNext?: string;
  /** Providers the form shows as buttons. Default `["github"]`. */
  providers?: AuthProvider[];
  /** Optional magic-link email row. */
  showEmail?: boolean;
  /**
   * Render plain links to /auth/sign-in instead of JS-driven buttons. Set by
   * the /login page when the cookie session is the source of truth (the
   * deployed weft.zip). Defaults to false to keep the desktop flow unchanged.
   */
  deployed?: boolean;
};

const PRIMARY_LABEL: Record<AuthProvider, string> = {
  github: "GitHub",
};

function GitHubMark() {
  // Inline SVG so the form renders without depending on a package's icon set.
  // GitHub is the only provider: the mark is the Octocat, sized to the button's 14px line.
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true" className="shrink-0 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

// Build a /auth/sign-in?provider=…&next=… URL for the deployed-site link path.
function webSignInHref(provider: AuthProvider, next: string): string {
  const params = new URLSearchParams({ provider, next });
  return `/auth/sign-in?${params.toString()}`;
}

// The magic-link email row, lifted out of LoginForm to keep that function under the
// complexity cap. Catches the API error and shows it inline so a server restart doesn't
// surface as an unhandled rejection.
function EmailMagicLink({ busy }: { busy: AuthProvider | "signout" | null }) {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  async function sendMagicLink(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setEmailError(null);
    try {
      await api.magicLink(trimmed);
      setEmail("");
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          void sendMagicLink(e);
        }}
        className="mt-2 flex flex-col gap-1.5"
      >
        <label htmlFor="login-email" className="text-[12px] font-medium text-muted">
          Or sign in with a magic link
        </label>
        <div className="flex gap-2">
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            disabled={busy !== null}
            className="min-w-0 flex-1 rounded-md border border-line-strong bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy !== null || !email.trim()}
            className="rounded-md border border-line-strong bg-card px-3 py-2 text-[13px] text-ink hover:bg-sunken disabled:opacity-50"
          >
            Send link
          </button>
        </div>
      </form>
      {emailError && (
        <p className="text-[12.5px] text-danger" role="alert">
          {emailError}
        </p>
      )}
    </>
  );
}

export function LoginForm({ defaultNext = "/app", providers = ["github"], showEmail = false, deployed = false }: LoginFormProps) {
  const { busy, error, waiting, signInWithOAuth } = useAuth({ defaultNext });

  // The callback page can come back with `?error=link&reason=…`. Read it on the
  // first render (no effect): a fresh form instance is mounted for every
  // navigation, so reading window.location once is the same as an effect, and
  // skips the cascading-render warning an effect would trigger.
  const initialParams = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const initialReason = initialParams.get("error") === "link" ? initialParams.get("reason") : null;
  const [reason] = useState<string | null>(initialReason);

  // Deployed path: a plain list of GET links, no JS, no waiting spinner.
  // The /auth/sign-in route is the round trip; the browser follows redirects.
  if (deployed) {
    return (
      <div className="flex flex-col gap-3">
        {providers.map((id) => (
          <a
            key={id}
            href={webSignInHref(id, defaultNext)}
            className="wz-loginProvider"
          >
            <GitHubMark />
            Continue with {PRIMARY_LABEL[id]}
          </a>
        ))}
        {reason && (
          <p className="text-[12.5px] text-danger" role="alert">
            The sign-in link didn&apos;t finish ({reason}). Try again.
          </p>
        )}
      </div>
    );
  }

  if (waiting && !busy) {
    return (
      <div className="flex flex-col items-center gap-2 py-3 text-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-hidden="true" />
        <p className="text-[14px] text-ink">Finish signing in in your browser.</p>
        <p className="text-[12.5px] text-muted">We&apos;ll bring you back here when it&apos;s done.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {providers.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => void signInWithOAuth({ provider: id })}
          disabled={busy !== null}
          aria-busy={busy === id}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-card px-4 py-2.5 text-[14px] font-semibold text-ink transition hover:bg-sunken disabled:opacity-60"
        >
          {busy === id ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-hidden="true" />
          ) : (
            <GitHubMark />
          )}
          Continue with {PRIMARY_LABEL[id]}
        </button>
      ))}

      {showEmail && <EmailMagicLink busy={busy} />}

      {error && (
        <p className="text-[12.5px] text-danger" role="alert">
          {error}
        </p>
      )}
      {reason && (
        <p className="text-[12.5px] text-danger" role="alert">
          The sign-in link didn&apos;t finish ({reason}). Try again.
        </p>
      )}
    </div>
  );
}
