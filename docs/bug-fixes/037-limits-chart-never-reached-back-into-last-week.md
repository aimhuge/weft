# 037 — the limits chart never reached back into last week

**Date:** 2026-10-24 · **Severity:** Low (no crash; the chart was right about the days it had and blank about the days it did not, so a user could not see how the week was spent)

## Symptom

Hovering the status strip's `5hr` / `7d` opened the burndown chart. On a Claude Code card it drew a week
of history and reached back into the days before the weekly reset when the account had them. On a **puku**
card it drew a flat seven days with nothing in it, and never reached back.

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

## The wrong fix (reverted)

The first fix here put Claude Code and puku-cli into **one pool per account** (`lib/plan-pools.ts`), on the
premise that both read the same Anthropic subscription's windows, and made the chart ask for the
account's history rather than the CLI's:

```ts
// the one-pool fix — app/api/limits/route.ts
const samples = readSamples();
return Response.json({ samples: backend ? samples.filter((s) => samePool(s.backend, backend)) : samples });
```

```ts
// the one-pool fix — components/LimitBurndown.tsx
apiFetch("/api/limits")
```

That premise was wrong: puku-cli bills through Puku's gateway (`lib/puku-proxy.ts` points at
`https://api-cli.puku.sh`) and has its own allowance, and the SDK's `rate_limits` come from the claude.ai
usage endpoint (`sdk.d.ts:4293`) — a gateway session has no plan window to report at all. Pooling the two
CLIs therefore did not share one history; it made a puku thread inherit Claude's spent 5-hour window, and
the New thread dialog blocked it with "Start at 2:30am" while changing the model changed nothing. See
docs/bug-fixes/041-a-puku-thread-was-held-behind-claudes-limit.md.

The chart now asks for the **CLI's own** history, which is the same request as before, and each CLI's plan
carries its own history.

## The fix

Each CLI has its own plan (`lib/plan-pools.ts` — `GROUPS` is empty), so the history belongs to the CLI
that read it, and the chart asks for it:

```ts
// after — components/LimitBurndown.tsx
apiFetch(`/api/limits?backend=${backend}`)
```

```ts
// after — app/api/limits/route.ts
const backend = new URL(req.url).searchParams.get("backend") as Backend | null;
const samples = readSamples();
return Response.json({ samples: backend ? samples.filter((s) => s.backend === backend) : samples });
```

`?backend=claude` answers with Claude Code's rows, `?backend=puku` with puku's own, `?backend=codex` with
Codex's. A CLI that has few readings has a thin chart — which is the truth about that plan, not a bug in
the chart.

Two bugs the per-CLI model was hiding went with it:

- **A parked card on the wrong CLI never resumed.** `lib/limit-resume.ts` filtered by pool, so a puku card
  parked on the account's spent window waited for a Claude Code reset to resume it. The filter is the
  CLI's own backend now, so Claude's reset does not release a card parked on Puku's allowance.
- **The log remembered the counter twice.** `lib/limit-history.ts` keyed its last-seen map by the pool, so
  puku's reading of the same counter looked like a change against puku's own stale value. The key is the
  CLI's own plan, so a puku reading is a sample of its own and not a repeat of Claude's.

**Key rule:** a window belongs to the plan, and each CLI has its own plan. History, the last-seen map and
the resume filter are all keyed by the CLI's own plan; the log still says which CLI reported.

## Files

- `lib/plan-pools.ts` — `poolOf()`, `samePool()`, `poolKey()`: the mapping, in one place. `GROUPS` is
  empty, so each CLI is its own pool
- `lib/plan-pools.test.ts`
- `lib/plan-limits.ts` — `planLimits()` gives each CLI the newest window of its own plan
- `lib/limit-reset.ts` — `planWindow()` answers with the CLI's own window
- `lib/limit-history.ts` — the last-seen map is keyed by the CLI's own plan
- `lib/limit-resume.ts` — the resume filter is the CLI's own backend
- `app/api/limits/route.ts` — `?backend=` means that CLI's readings; no param means all of them
- `components/LimitBurndown.tsx` — the chart fetches the CLI's own history
- `lib/limit-chart.ts` — `withCurrent()` stamps the card's own CLI, not a hardcoded "claude"
- `lib/use-start-gate.ts` — `samplesOf()` reads one window per CLI
- `docs/architecture/limits-burndown.md`, `docs/architecture/limits.md`, `docs/architecture/MAP.md`,
  `README.md`, `docs/ROADMAP.md`, `docs/bug-fixes/031-puku-cards-showed-claudes-limits.md`,
  `docs/bug-fixes/041-a-puku-thread-was-held-behind-claudes-limit.md`
