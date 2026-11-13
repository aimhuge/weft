# Weekly repo analysis

A board cron ("Weekly repo analysis", Sundays 22:00, fresh mode) measures this repo and writes a report page
the user opens in the browser pane.

## Where things live

- **Analyzers**: `plugin/skills/repo-analysis/scripts/` — `measure.sh` (size and shape, ~4s), `history.sh`
  (commits and changelog, ~5s), `coupling.mjs` (import graph), `docs-drift.mjs` (docs vs code; the older
  `docs-drift.sh` takes minutes). Each is read-only and prints to stdout.
- **Report folder**: `~/.weft/show/repo-analysis/`, outside the repo. Helper scripts there gather stats
  (`extra-stats.mjs`, `ratchet-check.mjs`, `baseline.mjs`), quota and token data (`limits-chart.mjs`,
  `usage-summary.mjs`), charts (`make-charts.mjs`) and assemble the page (`build-report-N.mjs`), which writes
  `report-YYYY-MM-DD.html`.
- **Publishing**: `publish.sh` copies the newest `report-*.html` over `index.html`, the page the user keeps
  open. The cron's last step runs it. Before it existed, `index.html` stayed frozen at the first run.

## Live numbers

The "Infrastructure & quotas" section refreshes each time the page opens: the page calls
`window.weft.liveData("/api/infra/live")`, which `electron/live-data.cjs` answers for pages in the pane
(an allow-list of routes, so a show page can't reach the rest of the API). The rest of the report is a
weekly snapshot, with the written values as fallbacks.
