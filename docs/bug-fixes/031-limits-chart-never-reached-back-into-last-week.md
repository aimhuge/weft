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

### The counter-hypothesis, and why the log refutes it

The two puku rows look, at a glance, like a mistake: a puku reading that matches Claude Code's to
the minute. The obvious reading is that they are Claude's own readings logged under the wrong
backend — that a card hit Claude's 5-hour limit, was switched to puku, and the reading its Claude
session still had coming was written under the card's new backend. That reading is testable, and the
log rules it out three ways.

**A mislabeled reading must be a duplicate, and it is not.** For each puku row, look for an *earlier*
Claude row with the same value *and* the same reset epoch:

| puku reading | used | reset | an earlier Claude row with the same value AND reset? |
| --- | --- | --- | --- |
| 19:45:15 five_hour | 100 | 1792765800 | **no** — no earlier Claude row has `used=100` with this reset |
| 19:45:15 seven_day | 14 | 1793332800 | yes, at 19:38:34 — the same value the counter had 7 minutes earlier |

The five-hour row carries a value Claude had never read. A re-reported reading cannot do that: it
must carry a value already in the log. And the weekly row's "match" is the opposite of a duplicate —
it matches the value the counter had *seven minutes earlier*, which is what a shared counter looks
like, not a copied line.

**The value fits the counter's trajectory.** The five-hour counter, minutes either side:

```
  19:41:20  claude  used= 97  resetsAt=1792765800
  19:42:25  claude  used= 98  resetsAt=1792765800
  19:43:51  claude  used= 99  resetsAt=1792765800
  19:45:15  puku    used=100  resetsAt=1792765800   <-- the next step, same reset epoch
  19:47:40  claude  used=100  resetsAt=1792765800
```

One counter, climbing. The puku reading is exactly the next step after Claude's 99, against the
*identical* reset epoch — not a near-miss, the same integer. Two separate plans could not produce
this: a puku plan would carry its own reset epoch, and a duplicate would repeat a value already in
the log. Claude's own 19:47:40 reading is also 100 — the counter had reached its ceiling — which is
exactly what made this look like a repeat.

**The mechanism makes it inevitable.** Both readings are attributed to the session that produced them:
`lib/runner-turn.ts` calls `updateLimits(id, session.spec.backend, …)` and `lib/limit-poll.ts`
calls `recordLimits(backend, …)` for the backend it polled. So a puku row means a puku session
reported it. puku-cli runs the Anthropic Agent SDK, so `usage_EXPERIMENTAL_*` returns the account's
real windows — the same account Claude Code draws from. Two readers, one counter.

**What the counter-hypothesis does get right.** A card that *switches* CLI can carry the old CLI's
stale stats onto the new one, and that is a real defect worth its own fix: clear a card's stats when
it switches, and record each reading under the CLI that sent it. But that is a bug about *stale
state on a card*, not a fact about the shape of the plan — and it does not make the two counters
separate.


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
