# GitHub issues

Status: issues → cards built 2026-10-12 (phase 2 below), and the per-project workflow — where cards land, and how a
"run" card works — 2026-10-28. One direction only: Weft reads issues and never edits one. Card → issue, two-way sync,
Projects v2 columns and comments are later phases.

Turn it on for a project in the **GitHub drawer** (GitHub's mark at the bottom of the left rail): tick **Issues →
cards** on its repo. Or from ⌘K: **Import GitHub issues into <project>** (the open thread's project, or your
most recent one). Either opts the folder in and syncs it right away; the toast reports how many cards were added,
updated and archived.

The drawer also shows who `gh` is signed in as (signed out, it shows `gh auth login --web` and **Check again**), each
synced folder's last sync or error, **Sync now**, and links to the repo and its issues in the browser pane. Unticking
stops the sync; the cards it made stay.

## The project's workflow

A card that lands in Backlog is cold: it waits among your other backlog cards, and a fresh import doesn't stand out.
Each project chooses its own workflow in the drawer, under the sync switch (**Land in**):

- **Backlog.** What the importer did before: a cold card, yours to pick up.
- **Needs you.** The card is made in Needs you, so it stands out. It never starts on its own, and it still follows its
  issue — a new label reaches it, and closing the issue archives it — until you run it. (Cards can't be *moved* into
  Needs you by hand; `app/api/cards/[id]` only allows Backlog, Review and Done as manual targets. The importer makes
  the card there instead.)
- **Run.** The card's thread starts at once. The agent works the issue and parks in Needs you when it needs a
  decision, exactly as any other thread does; when it finishes it goes to Review.

A **Run** card can be checked before any work happens, and worked by a chosen agent:

- **Checks with** — the skill that runs as the card's first turn. The card's prompt, then "Start by using the
  `<skill>` skill." The skill list is the project's own (`GET /api/skills?cwd=`): Weft's skills, yours in
  `~/.claude/skills`, and the folder's.
- **Works as** — the agent that works the card (`lib/agents.ts`), or the project's default.

**Design the agent** makes the validating agent with a short interview (**lib/agent-interview.ts**): what it should
check, what it must refuse, what it leaves behind, when it stops and asks, and its name. Weft writes a *soul* from
those answers — standing instructions, not a description ("read the issue, then the code it names") — saves it as an
agent, and picks it as the card's agent. The agent's soul is the first part of every system prompt its threads get
(`lib/agents.ts`), so the card's thread validates the issue under it and then carries on.

The workflow is per project folder, saved in `settings.json` under `issueLandings` (`lib/settings.ts`:
`issueWorkflow`, `setIssueWorkflow`; the type is `IssueWorkflow` in `lib/types-settings.ts`, so the drawer can use it
without pulling the server's modules in). Changing it changes where the *next* cards land; the ones already on the
board stay where they are.

## Instant updates, by webhook

The poll can leave a new issue waiting up to 5 minutes. **Instant, by webhook** (under the sync switch) puts a
webhook on the repo so cards follow within seconds. Weft runs on localhost, which GitHub can't reach, so the
webhook goes to the deployed Weft on Vercel (`https://weft-topaz.vercel.app/api/github/webhook`), which saves the
event on Weft's Supabase (project `lqjyravglujyizyqypxq`) for your Weft to hear. It needs you signed in to a Weft
account and admin on the repo.

1. **Add.** `lib/github-hooks.ts` `addHook` makes a 32-byte secret, saves a `github_hooks` row on your account
   (`repo`, `secret`; RLS: yours only, and no client can read `secret` back), then
   `gh api repos/<repo>/hooks --method POST --input -` with the secret on stdin (never in the process list):
   `events: ["issues"]`, URL `…/api/github/webhook?hook=<row id>` (`WEFT_RELAY_URL` points it elsewhere). GitHub's hook id goes back on the row.
   If GitHub refuses (404/403: not admin), the row is deleted again.
2. **Relay.** `app/api/github/webhook` on the Vercel deployment (the one Weft route with no localhost guard; the
   signature is its check) runs `lib/github-relay.ts`: it looks up the hook, checks `X-Hub-Signature-256`
   (HMAC-SHA256 of the body with its secret, compared in constant time), answers `ping`, drops events other than
   `issues`, checks the payload's repo is the hook's, and saves a `github_events` row (repo, event, action, issue
   number, delivery id; no payload) through Supabase's REST API with `SUPABASE_SECRET_KEY`, set on Vercel's
   Production environment only. It clears that hook's rows older than a day. Without the key it answers 503.
3. **Hear.** The Weft server keeps one Realtime channel on your `github_events` inserts while you're signed in
   and have a hook (`startHookListener` from `prewarm()`, following sign-in and sign-out). An event syncs every
   synced folder on that repo, 1.5s after GitHub's burst settles (opened, then labeled).
4. **Remove.** Unticking Instant, or turning the folder's sync off, deletes the hook on GitHub and the row.

The 5-minute poll keeps running, so a missed event (Weft closed, Realtime reconnecting) costs at most 5 minutes.

- `supabase/migrations/20261012131640_github_webhooks.sql`: `github_hooks`, `github_events`, their RLS and grants,
  and `github_events` in the `supabase_realtime` publication.
- `app/api/github/hooks`: POST `{folder}` adds, DELETE `{folder}` removes.
- The relay ships with every push to `main` (the `weft` Vercel project builds this repo); `SUPABASE_SECRET_KEY` is a
  Supabase secret key (`sb_secret_…`) for Weft Prod, listed in `.env.example`.

## How it works

`lib/github-issues.ts` reads issues through the `gh` CLI (`execFile`, no shell), so it uses your existing
`gh auth login` and needs no token of its own. The repo is the folder's (`gh repo view`).

For each opted-in folder, each open issue becomes a card:

- **Column**: the project's landing (`lib/issue-landing.ts` `landingColumn`) — Backlog, or Needs you when the project
  asked for that.
- **Title**: the issue's title (`titleBy: "user"`, so retitle leaves it).
- **Prompt**: the issue's body, a link to the issue, and "When you commit the fix, add `Fixes owner/name#N` to the
  commit message", so the commit closes the issue (`issuePrompt`).
- **Tags**: the issue's labels, normalized by `lib/tags.ts` (`tagsBy: "user"`). Each label goes into the tag catalog
  with its GitHub colour and description (docs/architecture/tags.md).
- **Agent**: the project's chosen agent, when it named one (`card.agent`).
- **`card.issue`**: `{repo, number, url, state, updatedAt}`. The card shows "#N", linked to the issue.

A **Run** card also starts its thread: `lib/issue-run.ts` `startIssueCard` sends the card's first message, with the
validation skill's line after it when the project named one. The runner is imported inside that function, so the
importer can hold it without pulling the runner into its module graph.

## Rules

- **A started card is never touched.** Once a card has left Backlog, has a session or has run a turn, it's yours.
  A card parked in Needs you has neither, so it keeps following its issue until you run it.
- **Closed issues archive their card** only if it never started.
- **An edited issue updates its card**: new labels replace the tags only when the issue changed since Weft last read
  it, so tags you edited on the card stay until the issue changes again.
- **A deleted card stays deleted.** Issue numbers already imported are kept in `~/.weft/github-issues.json`, per
  repo, and never imported again.
- One sync per folder at a time; a second call while one runs gets the same result.

## Pieces

- `lib/github-issues.ts`: `fetchIssues` (open issues, up to 500, plus the 100 most recently updated closed ones),
  `syncIssues`, `syncAllIssues`, `startIssueSync`, and each folder's last result or error (`issueSyncStatus`).
- `lib/settings.ts`: `issueFolders`, the opted-in folders; `issueWorkflow`, `setIssueWorkflow`, the workflow per folder
  (settings.json → `issueLandings`).
- `app/api/github/issues`: GET is each folder's sync status, POST `{folder}` turns it on and syncs now, DELETE turns
  it off, PATCH `{folder, landing, skill, agent}` sets the folder's workflow.
- `lib/issue-landing.ts`: the landings and their labels, `landingColumn`, `landingRuns`, `workflowOf` — pure, so the
  drawer and the server agree on what a landing means.
- `lib/issue-run.ts`: `startIssueCard` — the card's first message, plus the validation skill's line.
- `lib/agent-interview.ts`: the interview's questions, the lookup tables the answers map to, and `saveInterviewedAgent`
  (the soul it writes).
- `app/api/agents/interview`: GET the questions, POST the answers → `{ agent }`.
- `components/IssueWorkflowPicker.tsx`: the "Land in" control, the skill and agent pickers, and the interview.
- The poll starts in `prewarm()` (`lib/copilot.ts`), off the request path: a first sync 20s after the server
  starts, then every 5 minutes.
- `lib/github-status.ts` + `app/api/github` (GET `?folder=…`): the drawer's status, `gh api user` for the account (asked
  every load, so Check again works at once), each folder's repo (`repoOf`, cached 10 minutes, a miss 1 minute) and
  which repos have a webhook (`hookedRepos`).
- `lib/github-view.ts` (types, the sync line, toast and rail title), `lib/use-github.ts` (cached like the other drawers,
  `lib/use-linked-status.ts`, but through the Next server: `gh` needs no Electron bridge), `components/GithubDrawer.tsx`,
  `components/GithubLogo.tsx`.
- `components/board-palette.ts`: the ⌘K command.
- `components/CardMarks.tsx`: the "#N" link on the card.

## Later phases

1. **Card → issue.** Make an issue from a card (title, prompt, tags as labels), and link the card to it.
2. **Issues → cards.** Built (above).
3. **Two-way sync.** Title, labels and open/closed state kept in step both ways, with the newest edit winning.
4. **Projects v2 status columns.** Map a GitHub Project's Status field to Backlog, Running, Needs you, Review and
   Done, so moving a card moves the item.
5. **Comments.** Post a turn's summary to the issue, never the transcript. Vault values are removed first (the
   `‹NAME›` redaction), and a public repo gets a warning before anything is posted.
