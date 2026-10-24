# Weft account sign-in

The Weft account is optional: the board works signed out, and signing in unlocks cloud features (page sync,
share links, the Puku trial running on Weft's key). Sign-in runs in the system browser, never in the Weft
browser pane, and uses Supabase Auth with PKCE so the verifier only ever lives on this machine.

There are two surfaces:

- **`https://weft.zip/login`** on the deployed site: a real sign-in page. A signed-out visitor can sign in
  without the desktop app (the deployed site is the marketing surface; the page is how a download flow
  ends in a Weft account). GitHub only — the package-driven form accepts `providers: ["github"]` and the
  magic-link row is opt-in (`<LoginForm showEmail />`).
- **The desktop app** (`pnpm desktop`): the board's sign-in button, Settings → Weft account, and the
  Puku-trial upgrade prompt. The same GitHub round trip, plus the magic-link email field for the trial.

The two surfaces share `lib/auth/`, a thin wrapper whose public API mirrors `@aimhuge/auth`. When the
upstream tag with a `provider: "google" | "github"` option ships, swapping to the package is a one-line
change in `lib/auth/index.ts` — every other file imports from `@/lib/auth`.

## Redirect target

The OAuth and magic-link flows redirect to a stable, port-free URL Weft owns:

```
weft://account-callback
```

This is a custom URL scheme Weft registers with the OS. The dev server's HTTP port changes on every
Weft restart, so a `http://127.0.0.1:PORT/...` redirect would break after each launch; the `weft://`
scheme doesn't carry a port, so the URL is permanent.

In the packaged app, `app.setAsDefaultProtocolClient("weft")` (in `electron/main.cjs`) registers
the installed Weft.app as the OS handler. In `pnpm desktop` the dev Electron (`com.github.Electron`)
has no `CFBundleURLTypes` declared in its Info.plist, so macOS silently drops `weft://` clicks.
`scripts/dev-protocol.cjs` builds a thin wrapper app at `~/Applications/Weft Dev.app` with
`weft://` declared, registers it with LaunchServices, and forwards the link to the running dev
Electron (the wrapper's launcher execs the real Electron with the project as its folder and the
URL as a `--weft-link=weft://…` arg; `argvLink` in `electron/argv-link.cjs` parses it back out
for the `second-instance` handler). `pnpm desktop` runs the script before launching Electron,
and `pnpm dev:protocol` runs it standalone.

`lib/auth/desktop.ts:authRedirectTo()` returns the `weft://account-callback?next=…` URL when the
Electron shell is running (`process.env.WEFT_SHELL_URL` is set) and falls back to the
loopback HTTP origin for plain `next dev` (no Electron, no `weft://` handler at all).

## From link to session

### In the desktop app

1. The user clicks **Sign in** in the Weft top bar (or **Continue with GitHub** in Settings, or the
   Puku-trial upgrade prompt).
2. `useAccount().signIn("github")` (the re-export of `lib/auth/hooks.ts:useAuth`) calls
   `POST /api/account` with `{ action: "oauth", provider: "github", next }`. The route's
   `startSignIn()` (`lib/account.ts`) calls Supabase's `signInWithOAuth` with
   `redirectTo: weft://account-callback?next=…` and `skipBrowserRedirect: true`.
3. The hook opens the Supabase authorize URL in the system browser via `openExternal()`.
4. The user authorizes on GitHub. GitHub → Supabase → `weft://account-callback?code=…&next=…`.
5. The OS hands the URL to the Weft app: `open-url` (mac) or `second-instance` (Linux/Windows).
6. `handleLink` in `electron/main.cjs` sees the link is for the account callback and hands it to
   `accountLink.handle()` (built by `createAccountLink()` in `electron/account-link.cjs`). The handler
   parses the query string with `accountCallbackBody()` and POSTs it to `/api/auth/weft-callback`
   on the loopback server with `x-weft-token: 1` and `content-type: application/json`. The shared
   `warnUser` (in `electron/main.cjs`) is the single dialog the account-callback path uses for
   errors; `pageLinks` and `accountLink` both take it as `warn`, so the two flows stay in step.
7. The route (`app/api/auth/weft-callback/route.ts`) calls `finishSignIn(code)` (in
   `lib/account.ts`), which exchanges the code against the PKCE verifier kept in the session file
   (`~/.weft/account.json` or the Keychain via `electron/account-store.cjs`).
8. Success renders the same green page (`accountPage()` in `lib/account-page.ts`) the loopback
   callback returns, so both flows show the user the same page. The Electron handler shows the
   same message in a native dialog (it pulls the visible `<h1>`/`<p>` out of the HTML
   response so the dialog matches the browser). Because the page producer escapes its text as
   HTML entities and the dialog is a plain-text surface, the Electron handler also has to
   decode those entities after stripping tags — `extractErrorMessage()` in
   `electron/account-link.cjs` does both, preferring the `<p>` over the `<h1>` (the dialog
   title already says "Couldn't sign in to Weft") and falling back to a stock "Sign-in failed"
   line when neither is present. See `docs/bug-fixes/014-dialog-showed-html-entities.md`.
9. The board's `useAuth` polling (every 2s while `waiting` is set) picks up the new session
   when the user comes back to the board. On success, a `weft:account` window event fires
   so every `useAccount` instance reloads in step.

### On weft.zip

1. The visitor opens `https://weft.zip/login?next=/app`.
2. `app/login/page.tsx` is a server component. It awaits `searchParams` (for `next`) and
   `readSessionIdentity()` in parallel, inside a `<Suspense>`. If signed in, it renders the
   `SignedInPrompt` ("continue as …") instead of the form. If signed out, it renders
   `<LoginForm defaultNext={safeNext} providers={["github"]} />` — one "Continue with GitHub"
   button. `safeNextPath` rejects open-redirect tricks (`?next=//evil.com` falls back to `/app`).
3. The visitor clicks **Continue with GitHub**. `useLoginFlow` (or the local `useAuth`) POSTs to
   `/api/account` (or `/api/auth/start`, in the package shape) and opens the Supabase URL in
   the browser tab. The form sits in a "Waiting for GitHub…" state with a **Cancel** button.
4. The user authorizes on GitHub. GitHub → Supabase → `https://weft.zip/api/auth/callback?code=…&next=/app`.
5. `app/api/auth/callback/route.ts` is `createAuthCallback({ defaultNext: "/app" })`. On a
   provider error it redirects to `/login?error=link&reason=provider`; on a missing code,
   to `…&reason=nocode`; on an exchange failure, to `…&reason=exchange`; on success, to
   `safeNextPath(next, "/app")`. The session cookie is set on the response.
6. `/login` re-renders with `SignedInPrompt` if the cookie is now valid, or with the form and a
   one-line error under the title if the callback bounced.

### On a local web server (`WEFT_WEB=1`)

`WEFT_WEB=1` turns the weft.zip routes on for `next dev` without the home page taking over `/`
(see `isWebEnabled()` in `lib/home.ts`). The sign-in round trip is the same shape as the deployed
one, with two local adjustments:

1. The visitor opens `http://127.0.0.1:1024/login`. The form is the deployed one: a plain GET
   link to `/auth/sign-in?provider=github&next=…` (`LoginForm`'s `deployed` branch), because the
   session cookie lives on the same origin.
2. `app/auth/sign-in/route.ts` redirects to Supabase's authorize URL with `redirect_to` pointing
   at the local callback. `webCallbackOrigin()` (`lib/web-auth.ts`) pins that to
   `http://127.0.0.1:1024` — the browser may have reached the dev server as `localhost` or
   `127.0.0.1`, and Supabase matches the `redirect_to` against its allow-list exactly, so one
   host means one allow-list entry. `WEFT_WEB_ORIGIN` overrides it; a non-local request origin
   (a preview deployment, a tunnel) is left alone.
3. GitHub → Supabase → `http://127.0.0.1:1024/auth/callback?code=…&next=…`.
   `app/auth/callback/route.ts` exchanges the code, writes the session cookie through
   `webClient()`'s jar (a Route Handler's `cookies()` is writable) and 303s to `next`.
4. `proxy.ts` refreshes the visitor's cookie session before the team pages render. It gates on
   `isWebEnabled()`, not the deployed-only check: with the web routes on locally, an expired
   access token would otherwise bounce the visitor back to "signed out" on the very pages that
   need the session.

Supabase's Auth URL configuration must list `http://127.0.0.1:1024/**` for the return leg to
land at all (see `docs/architecture/teams.md`).

## Where it shows

- `lib/auth/hooks.ts:useAuth()` is the one hook behind both views: it loads `GET /api/account`, polls every 2s for up
  to 5 minutes while a sign-in finishes in the browser, and keeps every instance in step with a `weft:account` window
  event. `lib/use-account.ts` is a thin re-export with the board's `{ state, busy, error, waiting, signIn, sendLink, signOut }`
  shape, so `AccountButton.tsx` and `AccountSettings.tsx` keep their title strings and the "Finish in your browser" hint.
- `components/AccountButton.tsx`: the top bar button, right of Copilot (`CopilotButton.tsx`). Signed out it is the
  GitHub mark and "Sign in" (starts GitHub); signed in it is just your avatar (`components/Avatar.tsx`), which opens
  Settings. It renders nothing until the account loads, on a load error, or when accounts aren't configured.
- `components/AccountSettings.tsx` (Settings → Weft account): GitHub and Google buttons, an email-link form, who you
  are, and Sign out (this Mac only).
- `app/login/page.tsx`: the deployed weft.zip sign-in surface. GitHub only, the magic-link row is opt-in. A `<Suspense>`
  with a "Checking your account" spinner bridges the `readSessionIdentity` server call. The page is two panels, styled
  by the `.wz-login*` rules in `components/home/home.css`: on the left Weft's twin-suns speeder
  (`electron/assets/splash-speeder.jpg`) with the pitch over the sky, on the right the cockpit picture
  (`public/copilots/wingman.jpg`) with the sign-in as a glass card. Both are `next/image` with `fill`, a scrim keeps the
  text readable, and under 860px the panels stack.
- `app/app/page.tsx`: the small "you're signed in" card the deployed site lands on. It reads `latestRelease()` for the
  download CTA, so a signed-in visitor who came in from the marketing page leaves with the desktop app.

## Database

`supabase/migrations/` (applied to Weft prod through the Supabase MCP; the file versions match the server's):

- `profiles`: one row per user (id → `auth.users`, email, name, avatar), row-level security on, select and update
  only your own row, and only `name` and `avatar_url` are updatable. `private.handle_new_user()` is a
  `security definer` trigger on `auth.users` that creates the row; it lives in the unexposed `private` schema.
  Display fields come from `user_metadata`, which users can edit, so nothing may authorize on them.
- `lock_rls_auto_enable`: revokes the Data API's access to Supabase's own `public.rls_auto_enable()` event-trigger
  function (an advisor warning); the trigger still fires.

## Supabase project setup

For the sign-in flow to complete, the Supabase project's **Authentication → URL Configuration →
Redirect URLs** allowlist must include:

- `weft://account-callback` (the packaged desktop app, via Electron)
- `https://weft.zip/api/auth/callback` (the deployed site)
- `http://127.0.0.1:*/api/auth/callback` and `http://localhost:*/api/auth/callback` (plain `next dev`, no Electron)

The `Site URL` (used as a fallback) should not be relied on; set the allowlist entries explicitly. Email links use the
same allowlist and need custom SMTP before real users (the built-in mailer sends a few an hour).

The GitHub provider itself is configured under **Authentication → Sign In / Providers → GitHub** with
the GitHub OAuth app's client ID and secret, and the GitHub OAuth app's **Authorization callback URL**
must be `https://<project-ref>.supabase.co/auth/v1/callback` so Supabase can exchange the OAuth code
with GitHub.
