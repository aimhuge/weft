# 029: board fetches without the launch token made whole features vanish

**Date:** 2026-10-23 · **Severity:** High (a UI feature disappeared with no error, and an open thread rendered empty instead of failing)

## Symptom

Several things on the board simply stopped appearing, one after another, with no error anywhere:

- the header's uncommitted "+N/-N" counter (`components/PileBadge.tsx`),
- the code-quality badge (`components/QualityBadge.tsx`),
- the streak chip (`components/GameBadge.tsx`) and the league chip (`components/LeagueBadge.tsx`),
- the Backlog count (`components/BacklogBadge.tsx`),
- the profile dialog (`components/LoomDialog.tsx`),
- and, worst, an open card's thread (`lib/thread-transport.ts`) came back **empty** — no items, no error, as if the card had never run.

The limits chart had already lost its history the same way (another card's fix, in `components/LimitBurndown.tsx`).

## Cause

`lib/guard.ts` refuses **every** route — reads included — once the desktop app has written a launch token:

```ts
// lib/guard.ts
if (sent !== "1" && !hasToken(req)) return Response.json({ error: "Missing token" }, { status: 403 });
```

The board-side call sites fetched `/api/...` **without** the `x-weft-token` header, so each one got a 403. Every one of them then swallowed the failure in its own `.catch()` into an empty default, which is why the failure had no signal at all: a badge that renders `null` when it has no data, and a thread page that resolves to `null`.

The worst case was `lib/thread-transport.ts`, where a non-ok response became `null`:

```ts
// before — lib/thread-transport.ts
const res = await fetch(`/api/cards/${cardId}/thread?${params.toString()}`);
return res.ok ? ((await res.json()) as ThreadPage) : null;
```

So a 403 (guard refused) and an empty thread (the card genuinely has no items) looked identical to the user.

The header had five separate copies of the same literal header object, and no single place that knew how to talk to the board's own API.

## Fix

**One place knows the header** — `lib/api-client.ts`:

```ts
export const API_TOKEN_HEADER = "x-weft-token";
export const API_HEADERS: Record<string, string> = { [API_TOKEN_HEADER]: "1" };

export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has(API_TOKEN_HEADER)) headers.set(API_TOKEN_HEADER, "1");
  return fetch(url, { ...init, headers });
}
```

`apiFetch` builds a `Headers` from the call site's own `init?.headers`, so a call site keeps its `content-type` and can even set the token itself; it only adds the token when the call site didn't. It returns the `Response` unchanged, so `res.ok` / `res.json()` still work as before.

**Every board-side fetch goes through it.** The thread read now says what it means:

```ts
// after — lib/thread-transport.ts
const res = await apiFetch(`/api/cards/${cardId}/thread?${params.toString()}`);
return res.ok ? ((await res.json()) as ThreadPage) : null;
```

The other call sites migrated the same way: `components/PileBadge.tsx` (`/api/pile?cwd=`),
`components/QualityBadge.tsx` (`/api/quality?cwd=`), `components/GameBadge.tsx` (`/api/game`),
`components/LeagueBadge.tsx` (`/api/league`), `components/OnboardingTips.tsx` (`/api/game`),
`components/BacklogBadge.tsx` (`/api/sprint?cwd=`, twice), `components/LoomDialog.tsx` (`/api/game?full=1`),
`components/LeagueTab.tsx`, `components/LeaguesDialog.tsx`, `lib/use-scout.ts` (the GET of `/api/scout`),
`lib/use-tool-result.ts` (the local source's `/api/cards/:id/thread/tool/:toolId`),
`lib/pile-review.ts` (`/api/pile?cwd=…&prompt=1`) and `lib/welcome-client.ts` (the GET of `/api/welcome`).

The pre-existing hand-copied header objects were moved onto the shared constant, so the tree has one
source of truth instead of five: `lib/client-files.ts`, `lib/use-team.ts` (`WRITE_HEADERS`),
`lib/use-admin-gate.ts` and `lib/welcome-client.ts` (`WRITE`) all build on `API_HEADERS`.

**A guard so there is no seventh.** `lib/api-token-guard.test.ts` walks the real source tree with the
TypeScript parser (`sourceFiles` in `lib/client-graph.ts`) over `components/`, `lib/` and `app/`, finds every
`"use client"` file, and for every `fetch()` whose first argument is a string or template literal starting
with `/api`, asserts the call carries `x-weft-token`. It resolves a headers constant to its declaration and
follows the spread inside it, so it recognises the token by what the constant *contains*, not by what it is
called — a rename can't quietly unguard a fetch. Its `EXEMPT` map states a reason per file, and a second test
asserts every exempt path still exists, so the list can't go stale.

Deliberately **not** migrated: `components/ThemeSync.tsx` (its `/api/account` is analytics identity,
optional by design — a failure must leave the user anonymous, not raise an error; it is in `EXEMPT`),
`components/share-view/*` (those run on weft.zip with session-cookie auth, not the desktop's launch token)
and `lib/team-actions` (same reason).

**Key rule:** a board-side fetch of a local `/api` route carries `x-weft-token` — through
`apiFetch` (`lib/api-client.ts`), or a header object that names it. A 403 from `lib/guard.ts` is not an
empty result: never let it become one.

## Files

- `lib/api-client.ts` (new) — `API_TOKEN_HEADER`, `API_HEADERS`, `apiFetch`
- `lib/api-client.test.ts` (new) — 6 tests: the token is sent, url and init pass through, a call site's
  `content-type` survives, a call site that sets the token itself wins, no init works, `API_HEADERS` is the
  token header alone
- `lib/api-token-guard.test.ts` (new) — the regression guard over every `"use client"` file
- `lib/thread-transport.ts` — the open card's thread read
- `components/PileBadge.tsx`, `components/QualityBadge.tsx`, `components/GameBadge.tsx`,
  `components/LeagueBadge.tsx`, `components/OnboardingTips.tsx`, `components/BacklogBadge.tsx`,
  `components/LoomDialog.tsx`, `components/LeagueTab.tsx`, `components/LeaguesDialog.tsx`
- `lib/use-scout.ts`, `lib/use-tool-result.ts`, `lib/pile-review.ts`, `lib/welcome-client.ts`
- `lib/client-files.ts`, `lib/use-team.ts`, `lib/use-admin-gate.ts`, `lib/welcome-client.ts` — the
  pre-existing header copies moved onto `API_HEADERS`
- Tests updated for the new fetch init: `lib/pile-review.test.ts`, `lib/thread-transport.test.ts`,
  `lib/use-scout.test.ts`, `lib/use-tool-result.test.ts`, `lib/use-team.test.ts`,
  `lib/welcome-client.test.ts`, `lib/use-admin-gate.test.ts`, `components/PileBadge.test.tsx`
- `docs/architecture/overview.md`, `docs/architecture/board.md`
