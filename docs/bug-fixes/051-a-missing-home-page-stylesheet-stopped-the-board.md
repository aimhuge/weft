# 051: A missing home-page stylesheet stopped the board

- **Date:** 2026-11-12
- **Severity:** high (Weft wouldn't start: "The server didn't start at http://127.0.0.1:1024/api/cards")
- **Shipped in:** uncommitted

## Symptom

The splash screen said the server didn't start. `/api/cards` returned 500 with
`Module not found: Can't resolve './story.css'` from `components/home/Why.tsx`. A card redesigning the weft.zip
home page had written its new sections before their stylesheets (`story.css`, `demo.css`).

## Root cause

The board's cards route reached the marketing page:

```
app/api/cards/route.ts → lib/copilot.ts → lib/copilot-suggest.ts → lib/haiku.ts → lib/ai-observability.ts
  → lib/analytics-server.ts → lib/home.ts → components/home/Home.tsx → Why.tsx → ./story.css ✗
```

`lib/analytics-server.ts` only wanted `isDeployed()` from `lib/home.ts`, but `lib/home.ts` also held `loadHome()`,
whose `import("@/components/home/Home")` was meant to contain a broken home page (docs/bug-fixes/011). A dynamic
import narrows a runtime error, but Turbopack resolves the target's imports at build time, so a file the home page
can't find fails every route that can reach it. Even after the files existed, the running dev server kept the
cached resolve error until it restarted.

## Fix

`loadHome()` moved to its own module, `lib/home-loader.ts`, which only `app/page.tsx` and `app/home/page.tsx`
import. `lib/home.ts` is plain data and helpers again, safe for any server code.

`lib/home-loader.test.ts` walks every `app/api/**/route.ts` and `instrumentation.ts` (with `moduleFacts` from
`lib/client-graph.ts` and `resolveSpec` from `lib/import-check.ts`) and fails with the full chain if one reaches
`components/home/`. Putting the old re-export back makes it fail with
`app/api/account/route.ts → lib/home.ts → lib/home-loader.ts → components/home/Home.tsx`.
