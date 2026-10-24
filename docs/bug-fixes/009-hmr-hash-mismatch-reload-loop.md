# 009: the board reloaded in a loop on open (Next's "HMR hash mismatch")

- **Date:** 2026-10-12
- **Severity:** High (the board flashes and never settles; first cards took 24s instead of ~3s)

## Symptom

Opening Weft in dev mode, the server log repeated this every ~150ms for minutes:

```
✓ Compiled in 2ms
 GET /api/cards 200 in 12ms
 GET /api/cards 200 in 11ms
 GET / 200 in 80ms
```

No source file changed (a recursive `fs.watch` on the project saw only `.next/` writes). The dev log
(`.next/dev/logs/next-development.log`) showed one "Download the React DevTools" line per cycle: each one is a full
page load of the board, about 8 a second. It happened on some launches and not others.

## Root cause

A race in Next 16.4's Turbopack dev server (`next/dist/server/dev/hot-reloader-turbopack.js`; the race is still present in 16.4.3 and 16.5 canary):

1. The page connects and gets the HMR version `v` (`turbopack-connected`).
2. It subscribes each chunk with `hmrVersion: v` (`turbopack-subscribe`).
3. The server answers the first subscribe through `sendTurbopackMessage`, which bumps the version to `v+1` and logs
   "Compiled in 2ms".
4. Another chunk (Weft loads its panels, dialogs and badges lazily through `guarded()`, so there are many) subscribes
   before the `v+1` message reaches the page. Its `v` ≠ `v+1`, so the server sends `RELOAD_PAGE: HMR hash mismatch`.
5. The fresh page runs the same race.

The check exists for a page left over from an earlier server. A version *lower* than the server's only means updates
are on their way to a page that is already subscribed.

## Fix

`scripts/patch-next-hmr.mjs` (run from `postinstall`, idempotent, tested in `scripts/patch-next-hmr.test.ts`) changes
the check in both Next copies (CJS and ESM) to reload only on a version *newer* than the server's:

```js
// before
parsedData.hmrVersion !== undefined && parsedData.hmrVersion !== String(clientHmrVersion)
// after
parsedData.hmrVersion !== undefined && Number(parsedData.hmrVersion) > clientHmrVersion
```

If a Next upgrade changes that line, the script warns instead of failing the install. The test "finds the check in the
installed Next" fails then too, which is the cue to check whether upstream fixed it and delete the patch. The 16.4.3
patch release keeps the line byte-identical, so the patch still applies there and the check is still needed.

## Why it was hard to find

The log reads like a file watcher loop (compile, then reload), so the first suspects were files written into the
project (`next-env.d.ts` from `next typegen`, `supabase/.temp/`). The watcher ruled those out. The "Compiled" line is
an effect of the page's own subscribe, not a cause. Also, launching a second Weft to trace it kills the running one's
server (startup frees the port), so trace from logs, not a second launch.
