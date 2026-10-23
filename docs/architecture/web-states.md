# weft.zip's loading, error and not-found states

What a visitor sees while a weft.zip page loads, when it crashes, and when it isn't there. Visitors are strangers on a
website: no `~/.weft`, no threads, no Mac. Everything here is server components or tiny client ones, in
`components/web-states/`, styled by `web-states.css` (plain `wzs-*` classes, because `next.config.ts` sends every `.css`
through Tailwind, which drops module exports).

## Loading: skeletons shaped like the page

`components/web-states/Skeletons.tsx` has one `<Suspense>` fallback per public page, each drawn in the shape of what it
replaces so the swap doesn't jump:

| Fallback | Used by |
| --- | --- |
| `ProfileSkeleton` | `app/u/[username]/page.tsx` (hero, four number tiles, two sections) |
| `SharedCardSkeleton` | `app/s/[id]/page.tsx` (thread bubbles beside a page) |
| `SharedAppSkeleton` | `app/a/[id]`, `app/u/[username]/apps/[slug]`, `app/w/[org]/apps/[slug]` |
| `BoardSkeleton` | `app/[orgSlug]/board/page.tsx` (project bar and five columns) |

A fallback can paint before its page's CSS import runs, so each imports the stylesheets it needs and carries its page's own
wrapper (`.wz-app.wz-profile`, `.wz-desk`). The bars shimmer (`wzs-shimmer`) and stop under `prefers-reduced-motion`; the
words ("Loading the profile…") are a `role="status"` line that fades in after 1.2 s, so a fast load never flashes them.

The older "Loading…" text lived in `.wz-boardLoading`, a class only the web board's stylesheet defined, so four public pages
drew it unstyled. Nothing public uses it now.

## Failing: one error page, host-aware

`app/error.tsx` is the root boundary behind every page, and the desktop board and weft.zip share it. It asks
`lib/local-board.ts` `isLocalBoard()` (the Electron bridge `window.weft`, or a localhost host) through
`useSyncExternalStore`, with `false` on the server so weft.zip's first paint is the web page:

- desktop or localhost: `BoardError`, the original "The board failed to draw" box that talks about threads editing Weft
  and restores the native browser pane;
- weft.zip: `components/web-states/WebError.tsx`: "This page didn't load", Try again, Go to weft.zip and the error's
  digest as "Reference …" to quote. The message is never shown: in production React hides it anyway (the minified
  #441 a mini-app crash showed on 2026-10-23).

`WebProblem.tsx` is the shared card (the brand's `wz-authCard` on its backdrop) that `WebError` and `app/not-found.tsx` draw.

## Not found

`app/not-found.tsx` answers every `notFound()` (a revoked share, an unknown profile, a renamed mini app) and every unknown
address: "Nothing here" with a way home, `noindex`. Without it Next drew its own bare white page.

## A pane that doesn't load

The shared card's pane and a shared mini app frame a page in an iframe. `components/share-view/PaneFrame.tsx` wraps it:
a skeleton with "Loading the page…" until `onLoad`, and after 12 s or an `error` event "This page didn't load" with Try
again (remounts the frame with a new key) and, when the caller has an address, Open ↗. One limit: a site that refuses
framing still fires `load` in Chrome, so that case stays blank; the viewer header's Open ↗ is its way out.

## Key rule

Never pass a function from a server component to a client component. `SharedApp` once took a `renderSecretForm` prop from
`shared-app-body.tsx`, which crashed every `/@user/apps/<slug>` page; the secret form (`AppSecretForm`) is now `SharedApp`'s
own state, and `components/share-view/SharedApp.test.tsx` covers it.

Tests: `lib/local-board.test.ts`, `components/share-view/PaneFrame.test.tsx`, `SharedApp.test.tsx`. The skeletons and error
pages are static markup and have no test of their own.
