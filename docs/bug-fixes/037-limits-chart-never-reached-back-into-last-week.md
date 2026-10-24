# 037 — the limits chart never reached back into last week

**Date:** 2026-10-24 · **Severity:** Low (no crash; the chart was right about the days it had and blank about the days it did not, so a user could not see how the week was spent)

## Symptom

Hovering the status strip's `5hr` / `7d` opened the burndown chart. On a Claude Code card it drew a week
of history and reached back into the days before the weekly reset when the account had them. On a **puku**
card it drew a flat seven days with nothing in it, and never reached back.

The two cards sit on the same account and read the same counters, so the puku card's chart was the same
chart with the history taken away.

## Root cause

`components/LimitBurndown.tsx` asked for the **CLI's** readings:

```ts
// before — components/LimitBurndown.tsx
apiFetch(`/api/limits?backend=${backend}`)
```

and `app/api/limits/route.ts` answered with exactly that CLI's rows. The plan log held **two** puku
readings and 763 Claude Code ones, so a puku card's chart had two rows to draw: one flat week, no
lookback, and the day-before-the-reset days missing from the left of the plot.

The lookback in `lib/limit-chart.ts` is not a bug and never was:

```ts
const back = now - weekStart < NEW_WEEK && rows.some((s) => s.at < weekStart) ? LOOKBACK_DAYS : 0;
```

The chart reaches back only when the history it was given actually holds those days. It was never given
them.

## Fix

The plan limits are **one pool per account** (`lib/plan-pools.ts`): Claude Code and puku-cli read the
same Anthropic subscription's windows, so the history belongs to the account and the CLI only names the
plan. The proof — the SDK's `rate_limits` come from the claude.ai usage endpoint and are null for
API-key sessions, and the log's own puku rows carry Claude Code's reset epoch to the second — is in
docs/architecture/limits-burndown.md.

So the chart asks for the account's history, and the route answers with the plan's:

```ts
// after — app/api/limits/route.ts
const backend = new URL(req.url).searchParams.get("backend") as Backend | null;
const samples = readSamples();
return Response.json({ samples: backend ? samples.filter((s) => samePool(s.backend, backend)) : samples });
```

```ts
// after — components/LimitBurndown.tsx
apiFetch("/api/limits")
```

`?backend=claude` and `?backend=puku` now answer with the same rows — the account's — and
`?backend=codex` with Codex's own.

Three more bugs the per-CLI model was hiding went with it:

- **The server and the client disagreed about the gate.** The server (`lib/start-gate.ts`) read the raw
  log and `lib/limit-reset.ts` `planWindow()` filtered by the CLI, while the browser read
  `/api/limits/plans`. The dialog could say "Start at 2:30am" and the server start the card anyway.
  `planWindow()` is pool-aware now, and `lib/use-start-gate.ts` `samplesOf()` reduces the payload's
  duplicate per-CLI copies to one sample per pool per window, so both sides read the same thing.
- **A parked card on the wrong CLI never resumed.** `lib/limit-resume.ts` filtered
  `c.backend === backend`, so a puku card parked on the account's spent window waited for a Claude Code
  reset to resume it. The filter is `samePool()` now.
- **The log remembered the counter twice.** `lib/limit-history.ts` keyed its last-seen map by
  `` `${backend}:${kind}` ``, so puku's reading of the same counter looked like a change against puku's
  own stale value, and a pool reset seen on Claude Code did not fire for puku. The key is the pool's.

**Key rule:** the window belongs to the plan, the reading to the CLI. History, the last-seen map and the
resume filter are all keyed by the plan; the log still says which CLI reported.

## Files

- `lib/plan-pools.ts` (new) — `poolOf()`, `samePool()`, `poolKey()`: the mapping, in one place
- `lib/plan-pools.test.ts` (new)
- `lib/plan-limits.ts` — `planLimits()` computes the pool's newest window and copies it onto each
  entry of that pool, each as its own copy
- `lib/limit-reset.ts` — `planWindow()` is pool-aware, so the server and the browser agree
- `lib/limit-history.ts` — the last-seen map is keyed by the pool
- `lib/limit-resume.ts` — the resume filter is `samePool()`
- `app/api/limits/route.ts` — `?backend=` means the plan's readings; no param means all of them
- `components/LimitBurndown.tsx` — the chart fetches the account's history
- `lib/limit-chart.ts` — `withCurrent()` stamps the card's own CLI, not a hardcoded "claude"
- `lib/use-start-gate.ts` — `samplesOf()` reads one window per pool
- `docs/architecture/limits-burndown.md`, `docs/architecture/limits.md`, `docs/architecture/MAP.md`,
  `README.md`, `docs/ROADMAP.md`, `docs/bug-fixes/031-puku-cards-showed-claudes-limits.md`
