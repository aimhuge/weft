# 031 — the limits chart never reached back into last week

**Date:** 2026-10-24 · **Severity:** Medium (no crash and no wrong numbers on screen: the chart silently showed a flat seven days, and the "last week" lookback never drew, however fresh the weekly reset)

## Symptom

The status strip's hover over `5hr` / `7d` draws the week's burndown chart. In the first days of a week
it is supposed to reach back into the days of the week before — the days of the week before sit on the
left of the plot, shaded and dimmed, with a "last week" label. That lookback never fired: the chart
stayed at seven days, however fresh the weekly reset.

It was worst on a card on the CLI with the fewest readings. On the author's machine the history log
held 684 samples: 682 from Claude Code and 2 from puku, both from one evening on 2026-10-23. A puku
card's chart saw no history before the week began, so the lookback condition was permanently false.

## Root cause

The chart asked `/api/limits` for **one CLI's** slice of the limit history (`?backend=`), and it did
so on the belief that each CLI has its own plan. The plan limits are in fact **one pool per account**,
shared by every CLI: Claude Code and puku-cli report the same 5-hour and weekly windows, with the
same reset times, because they draw from the same plan. Measured on 2026-10-23: puku read
`five_hour used=100 resetsAt 21:30` at 19:45:15, while Claude Code read `used=99` at 19:43:51 and
`used=100` at 19:47:40 against the same 21:30 reset — one climbing counter, not two.

Filtering the history by CLI therefore cut the chart's input down to the CLI with the fewest
readings, and the lookback could never fire:

```ts
// before — lib/limit-chart.ts
const back = now - weekStart < NEW_WEEK && rows.some((s) => s.at < weekStart) ? LOOKBACK_DAYS : 0;
```

```ts
// before — components/LimitBurndown.tsx
function useSamples(backend: Backend) {
  // ...
  apiFetch(`/api/limits?backend=${backend}`)
  // ...
}
```

The rule itself was right — the lookback fires only when the history has a sample older than the
week's start. The history it was given simply didn't have one.

The same wrong assumption sat in `lib/plan-limits.ts`: `planLimits()` kept each CLI's **own** newest
reading of each window, so a card on a CLI that stopped reporting showed that CLI's stale snapshot
instead of the account's real limits.

## Fix

**The history behind the chart is the account's.** `useSamples()` no longer takes a `backend` and no
longer asks for `?backend=`; it reads `/api/limits`, whose default answer is the account's whole
history. The component's `backend` prop stays: it still names the card's own CLI's plan in the
header ("Claude Code's plan" / "puku-cli's plan") and still supplies the summary numbers.

```ts
// after — components/LimitBurndown.tsx
// The whole account's limit history, every CLI's readings together.
function useSamples() {
  const [samples, setSamples] = useState<LimitSample[]>([]);
  useEffect(() => {
    let live = true;
    apiFetch("/api/limits")
      .then((res) => (res.ok ? res.json() : { samples: [] }))
      .then((body: { samples?: LimitSample[] }) => live && setSamples(body.samples ?? []))
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return samples;
}
```

`app/api/limits/route.ts` already answered with the account's whole history by default; its `?backend=`
narrowing is now **gone**, so the trap that caused this bug cannot be walked back into. The one place
that wants a single CLI's own readings reads the log itself (`lib/plan-limits.ts`, on the server).

**`planLimits()` puts the pool's reading on every entry.** It now computes the pool's newest reading
of each window and puts it on every CLI's entry, while each entry stays keyed by the CLI that
reported (so the strip can name it). A card on a CLI that stopped reporting shows the account's real
limits instead of a stale snapshot of its own — on the machine above, puku's entry now carries
`used: 25`, the pool's newest reading, rather than puku's own stale `100` from 19:45.

Each entry gets its **own copy** of the pool's window, not the pool's object: a consumer that
changes one CLI's window (to mark it stale, say) must not change every other CLI's window with it.

```ts
// after — lib/plan-limits.ts
export function planLimits(samples: LimitSample[]): PlanLimits {
  const plans: PlanLimits = {};
  let fiveHour: { window: LimitWindow; at: number } | undefined;
  let sevenDay: { window: LimitWindow; at: number } | undefined;
  for (const s of [...samples].sort((a, b) => a.at - b.at)) {
    const window: LimitWindow = { used: s.used, ...(s.resetsAt !== undefined && { resetsAt: s.resetsAt }) };
    if (s.kind === "five_hour") fiveHour = { window, at: s.at };
    else sevenDay = { window, at: s.at };
    const plan = (plans[s.backend] ??= { reportedAt: s.at });
    plan.reportedAt = Math.max(plan.reportedAt, s.at);
  }
  // The pool's newest reading of each window, on every entry: the account shares one pool.
  for (const plan of Object.values(plans)) {
    if (fiveHour) {
      plan.fiveHour = { ...fiveHour.window };
      plan.fiveHourAt = fiveHour.at;
    }
    if (sevenDay) {
      plan.sevenDay = { ...sevenDay.window };
      plan.sevenDayAt = sevenDay.at;
    }
  }
  return plans;
}
```

**A pool window is dated by the pool's reading, not by the CLI that carries it.** The entry's
`reportedAt` is when that CLI last reported (the strip names the plan by it); `fiveHourAt` /
`sevenDayAt` are when the pool read each window. `lib/use-start-gate.ts` stamps the sample it
builds with the window's own time, so the start gate never claims a value was seen before it was
read.

**Key rule:** the plan limits are one pool per account — the history behind the chart is the
account's whole history, and every CLI's plan entry carries the pool's newest reading, whatever CLI
reported it.

## Files

- `components/LimitBurndown.tsx` — `useSamples()` takes no `backend` and reads `/api/limits`; the
  `backend` prop still names the card's own CLI's plan
- `app/api/limits/route.ts` — the `?backend=` narrowing is removed; the route answers with the
  account's whole history and nothing else
- `app/api/limits/plans/route.ts` — comment only
- `lib/plan-limits.ts` — `planLimits()` computes the pool's newest reading of each window and puts it
  on every CLI's entry (each its own copy); each entry stays keyed by the CLI that reported, and each
  window carries the pool's own read time
- `lib/use-start-gate.ts` — stamps each sample with the window's own read time, not the reporting
  CLI's last report
- `components/StatusStrip.tsx` — comments only (it names the CLI but shows the pool's numbers)
- `components/LimitBurndown.test.tsx` — a new test reproducing the bug: a puku card with a week of
  Claude Code readings reaches back into last week
- `lib/plan-limits.test.ts` — the pool's numbers on every entry; a CLI that stopped reporting gets the
  pool's newer reading; a CLI that never reported has no entry; each entry's window is its own copy
- `lib/use-start-gate.test.ts` — a pool window keeps the pool's own time
- `app/api/limits-route.test.ts`, `app/api/limits-plans-route.test.ts` — updated
- `docs/architecture/limits-burndown.md` — the chart's data flow and the one-pool-per-account rule
