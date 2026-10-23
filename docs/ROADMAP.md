# Weft roadmap

Weft is a desktop kanban board where every card is a Claude Code, puku-cli or Codex thread, with a shared browser pane and a copilot that can run the board.
This file lists the features we still need, grouped by area, one line each, so we can pick work and argue about priority in one place.
Tags: `Now` is being built this session; `P1` is next and high value; `P2` is clearly useful; `P3` is later or speculative.

## Top 10 next

1. **Diff view in Review** — show what a card changed since it started, so reviewing a finished turn doesn't mean switching to an editor.
2. **Copilot acts on its own** — the copilot now hears what finished, failed, or needs you with each of your messages; next, let it start a turn when that happens instead of waiting to be asked.
3. **Markdown in threads** — render agent replies with headings, code blocks, and tables instead of plain text.
4. **Always-allow rules** — "allow always for this card / this project" on permission prompts, so the same `npm test` doesn't ask twenty times.
5. **Commit, push, and open a PR from a card** — finish the loop from Review without leaving the board, and keep the PR link on the card.
6. **Browser tab per card** — each card gets its own tab in the pane, so two agents testing two apps don't navigate over each other.
7. **Import existing CLI sessions** — turn threads started in a terminal (`~/.claude/projects`, `~/.puku-cli/projects`) into cards that resume them.
8. **Queue a reply while running** — let you type the next instruction while a turn is working; it's sent when the turn ends.
9. **Concurrency cap and run queue** — limit how many cards run at once and start the rest from Backlog in order, so a batch of cards doesn't swamp the machine or the rate limit.

## Board and organization

- `Now` **Projects bar** — a bar above the columns listing the project folders in use, to filter the board to one or more projects and sort cards by activity or age.
- `Done` **Recently changed in ⌘K** — the palette opens on the cards that moved column in the last day, latest move first (`recentMoves` in `lib/board-view.ts`, stamped as `columnAt` by `lib/store.ts`).
- `Done` **Bigger ⌘K with the last output** — the palette is 840px wide with larger type; each card row shows its last line of output (or error) and how long ago it changed (`preview` and `when` on `PaletteItem`, filled in `components/board-palette.ts`).
- `Now` **Filter quick-open** — the filter box shows its `/` key, lists the top matching cards as you type (Enter opens one) and hands the text to the ⌘K palette.
- `Done` **Order within the Backlog** — drag a card above or below a sibling to save the order, which takes precedence over the selected sort so the top card is next (`lib/store.ts`, `lib/board-view.ts`, `lib/use-board-card-actions.ts`, `components/BoardColumn.tsx`).
- `P1` **Archive instead of delete** — Done cards move to a searchable archive after N days; today delete also removes the card's thread view for good.
- `P1` **Undo** — a short undo toast after a move, stop, or delete, since a misplaced drag or delete is easy to make and hard to fix.
- `Done` **Archive keys** — `Shift+A` archives the focused card (else the open thread) and steps focus to the next one, `Shift+E` archives the Done column, and `Z` or the toast's Undo restores the last archive (`lib/archive.ts`). Archive is the first action with undo.
- `Done` **Card actions menu** — right-click a card for a native, one-click menu (`lib/card-menu.ts`): open, rename, start, move, stop, run Weft skills, dev server, new thread here, reveal folder, copy path or resume command, archive, delete. Columns get New thread, and Done gets show archived and archive all. Every item has a key that picks it while the menu is open (`D` Done, `1` `/weft:done`, `Y` YOLO). Fork isn't in it yet.
- ~~`Done` **Card library**~~ Replaced by star + tags (2026-10-12). Its recipes, to-dos and notes became starred cards tagged `recipe`, `to-do` or `note`; the files stay on disk.
- `Done` **Star and tags** — ☆ on every card and thread header (card menu `K`) stars a card, which is never auto-archived, and the rail's ★ shows only starred ones. Tags follow GitHub label rules (lowercase, ≤50 chars, ≤8 per card): up to two pills on the card's stage line, a tags dialog (`G`), and the 🏷 drawer (⌘L) like GitHub's labels page, with a colour catalog in `~/.weft/tags.json`. The retitle Haiku call also tags untagged cards from the board's own vocabulary, and the copilot has `set_tags` (docs/architecture/tags.md).
- ~~`P2` **Library page snapshots**~~ Dropped with the library.
- ~~`P2` **Fill recipe blanks in the pane**~~ Dropped with the library.
- `P2` **Swimlanes by project** — optional rows per project folder, so a board spanning several repos stays readable.
- ~~`P2` **Labels**~~ Shipped as tags: colored, filter the board from a pill or the 🏷 drawer.
- `P2` **Priority** — a priority field that sorts Backlog and that the run queue respects.
- `P2` **Saved views** — named filter and sort combinations, such as "this repo, Needs you first".
- `P2` **Bulk actions** — select several cards to start, stop, move, or archive them together.
- `P2` **Dependencies** — "start this card when that one reaches Review or Done", for work that has to happen in order.
- `P2` **Card density toggle** — compact cards (title and status only) for big boards, detailed cards for small ones.
- `P2` **Column counts and limits** — show counts per column and warn when Running goes over a set number.
- `P3` **Multiple boards** — separate boards (work, side projects) you switch between in the app, instead of restarting with another `WEFT_DATA`.
- `P3` **Custom columns** — add columns like "Blocked" or "QA" and map BOARD STATUS values onto them.
- `P3` **Timeline view** — a lane per card showing when it ran and when it waited on you, to see parallelism and dead time.

## Cards and threads

- `Done` **Codex CLI backend** — new threads can run and resume Codex sessions, with Codex sandbox and reasoning effort settings, backend switching, and login status. Weft's MCP tools reach Codex over HTTP (`/api/mcp/[server]`), its folder's `CLAUDE.md` and `.claude/skills` are passed along; per-tool guards are not available to Codex threads.
- `Now` **Auto-retitle cards** — after a turn, a card named "Image attachment", "Untitled thread" or just its prompt's first line gets a Haiku title with an emoji (`lib/retitle.ts`, hooked in `lib/show.ts`); `titleBy` marks a card named by you or by Weft so neither it nor Claude Code's sync renames it again. Still open: retitling when the thread's topic drifts, and a "rename with AI" card menu item.
- `Now` **Summary-first cards with a picture** — the card leads with the thread's last line in plain text, a 52 px thumbnail of its latest picture (thread screenshots and images, or a pane capture after each turn; hover to enlarge), an 8-dot stage bar with what's left, and a one-line footer. No picture yet: a Haiku emoji tile, or the folder's initial. Still open: emoji for cards that haven't had a turn since, and a setting to hide thumbnails.

- `Now` **Managed thread prompt and BOARD STATUS** — every board thread gets a system prompt asking it to end replies with a `BOARD STATUS` line; the board uses it to move the card to Needs you, Review, or Done and to show its stage and what's left. The parser skips status lines quoted in code blocks and reads the bold-label form (`**BOARD STATUS:** ...`).
- `Now` **Questions the Claude Code way** — AskUserQuestion shows above the reply box with numbered options (↑/↓, 1–9, Enter), multi-select checkboxes, a tab per question and a Submit tab whose box text goes with the answers as a note; the reply box is the one input (own answer or a note, sent as annotations) and option previews open in the browser pane (`components/QuestionForm.tsx`, `lib/question-answers.ts`, `lib/question-preview.ts`). Still open: answering from the card or a notification without opening the thread.
- `Now` **Markdown rendering** — messages render as Markdown (headings, lists, tables, code blocks with a Copy button) in the same style as the composer. Still open: syntax highlighting.
- `Done` **One mode, one named button** — the reply box names what Enter does on a chip and its primary (Send, Queue, Answer, Run, Replace, New card, Send at the reset, Continue after a cut-off turn), with Send now, Send later and Send here in a ▾ menu and Stop in its own slot (`lib/reply-mode.ts`, `components/ReplyButtons.tsx`; the audit and the rest of the plan: one dock for every ask, one server-side queue, fewer bands, in docs/architecture/composer.md).
- `Now` **Send later** — the reply box's send menu (Alt+Enter) schedules a message for a set time, by default a minute after the plan's next 5-hour reset, or the weekly reset when the weekly limit is used up (offered from 90%); the server sends it even with the thread closed. Still open: scheduling from the copilot.
- `Now` **Suggested next message** — the Agent SDK's prompt suggestions (`promptSuggestions`) land on the card after each turn; the reply box shows the suggestion as its placeholder and Tab fills it in without sending. Claude threads only (not puku-cli or the copilot). Still open: a suggestion on the card itself, and one after a session's first turn (the CLI holds it back).
- `P1` **Queue a reply while running** — the reply box is disabled while a turn runs ("Working. Stop it to reply."); let you queue the next message instead.
- `P1` **Import existing CLI sessions** — list sessions from the CLIs' project folders and turn any of them into a card that resumes it.
- `Now` **Images in prompts and replies** — paste or drop images and videos into the new-thread dialog and reply box, inline where they go; PNG, JPEG and GIF uploads convert to WebP, images reach the agent as image blocks, and videos as file paths. Files dragged from Finder also land on a card, an open thread or empty board (a new thread).
- `Now` **Composer** — the new-thread dialog and reply box share a Markdown editor (formatting bar, ⌘B/⌘I, raw Markdown view), local dictation with whisper.cpp, and saved drafts.
- `Now` **Repo picker** — the new-thread folder field lists recent projects, git repos on this Mac with their branch, and GitHub repos through `gh`, cloning one into `~/dev` when picked.
- `P2` **Dictation hotkey and live text** — a shortcut to start the mic, and words appearing while you talk instead of after.
- `P1` **Fork a thread** — start a new card from a thread's current session, to try a second approach without losing the first.
- `P1` **Card templates** — saved prompts with folder, CLI, and permission mode ("fix lint", "add tests for X", "review my diff"), picked from the new-card dialog.
- `P1` **Full tool output** — tool results are clipped to 4,000 characters and summaries to 100; add "show full output" that reads the CLI's own transcript.
- `Now` **Collapsible tool runs** — a run of tool calls folds into one line ("Ran 3 commands, read 2 files +1") that opens to each call; screenshots stay visible under it.
- `Now` **Images in threads** — tool screenshots, images pasted into Claude Code sessions and local images an agent shows with `![](path)` appear inline, saved in `~/.weft/attachments`; click for full size.
- `Now` **Live sessions move columns** — a session busy in another app moves to Running, one waiting on a question to Needs you, read from Claude Code's own session list every 5 seconds.
- `P2` **Subagent drill-down** — subagent turns are hidden today; show them nested under the Task call that started them.
- `Done` **Continue and retry from the card** — a ▶ in the footer of any idle card with a session sends "continue" (for a model that gave up too early); a stopped or failed card also gets **Restart**, its last message again in a fresh CLI (`lib/card-resume.ts`, `lib/restart.ts`). **▶ Resume N** in the Review header carries on every turn there that a restart cut off or that failed (`lib/resume-actions.ts`).
- `Now` **Edit your last message** — ↑ in an empty reply box brings it back; Enter stops a running turn, rewinds the conversation to before the message (`resumeSessionAt`), folds the old turn into an "Edited" line, and sends the new text. Files stay as the turn left them. Claude board threads only; others send the edit as a new message. Still open: editing an older message, and undoing that turn's file edits (`rewindFiles`).
- `P2` **Auto-title** — name a card from its first exchange when you left the title blank, instead of the first 60 characters of the prompt.
- `Now` **`!` shell commands** — a reply starting with `!` runs in the card's folder (`lib/shell.ts`, `POST /api/cards/:id/shell`), shows in the thread, and its output goes to Claude with your next message as `<bash-input>`/`<bash-stdout>`, as Claude Code's bash mode does. Still open: streaming output while it runs, stopping one early, ↑ history of past commands, and aliases (it runs `$SHELL -c`, not an interactive shell).
- `P2` **Slash commands and skills in the reply box** — list the CLI's slash commands and skills available in the card's folder.
- `Now` **Skill sets** — one library of skills (Weft's, the project's, yours, your Claude Code plugins); each project has a default set seeded from what its threads ran, and each card can change its own (✦ on the rail, ✦N in the card header). Claude Code and puku get it as `skillOverrides` + `enabledPlugins` at session start, Codex and puku as a filtered skill index (`lib/skill-sets.ts`, `lib/skill-usage.ts`, `lib/skill-library.ts`, docs/architecture/skills.md). Next: a skills marketplace (search, preview, install into the library), New skill from a card, the copilot's own set, applying a change to a running CLI.
- `P2` **File mentions** — `@` autocompletes file paths from the card's folder in prompts and replies.
- `P2` **Context meter and compact** — show how full the thread's context is and offer `/compact` before it runs out mid-task.
- `P2` **Turn timings** — duration per turn and per tool call, so you can see where a slow turn spent its time.
- `P2` **Thread outline** — a jump list of your messages and turn results in the thread panel.
- `P2` **Private card notes** — a note field for you that the agent never sees.
- `P2` **Export a thread** — save a thread as Markdown to paste into a PR, issue, or doc.
- `P3` **Scheduled cards** — start a Backlog card at a set time or on a schedule (nightly dependency bump, weekly audit).
- `P3` **Re-run and compare** — run the same prompt again later and compare the result with the last run.

## Git, worktrees and code review

- `Not planned` **Worktree per card** — a worktree costs a fresh checkout, `npm install` and env setup per card, and leaves stray folders; Weft warns about busy folders and overlapping files instead (SOUL.md).
- `P1` **Branch per card** — a branch named from the card title (`tb/fix-login-redirect`), shown on the card.
- `P1` **Diff view in Review** — the files and hunks a card changed since it started, in the thread panel.
- `P1` **Commit, push, and open a PR** — buttons that commit the card's work, push its branch, and open a PR with `gh`; the PR link is saved on the card.
- `Done` **Busy-folder warning** — a card shows an amber "+N here" on its folder line while another card is busy in the same folder, and the New thread dialog says "Also running here: …" (`lib/overlap.ts`). It doesn't look at uncommitted changes. The reply box's always-on line was dropped (in a busy repo it always showed); symbol claims below warn at the actual clash instead.
- `Done` **Symbol claims** — a card claims the top-level function, component or class it edits (`Board.tsx#CommandPalette`, found from the Edit's `old_string` with the TypeScript parser; a symbol over 150 lines splits into the statement holding the edit, `Board.tsx#Board/useEffect#3`; `card.claims`, last 50); when another busy card goes to edit a claimed symbol, a PreToolUse hook asks the user to wait or go ahead (`lib/claim-guard.ts`). Imports are never claimed; Write, NotebookEdit, non-TS files and edits spanning more than five symbols claim the whole file. Claims drop at Done, on archive, and once `git status` shows the file clean (the commit walk-through or a thread's own `git commit`).
- `Done` **Bash claims** — a Bash line that writes a claimed file asks first, what a Bash call wrote becomes the card's claim, and a failed check is told which failures are another card's (`lib/bash-claims.ts`, `lib/failure-owners.ts`).
- `Next` **Opt-in worktrees** — an Isolated switch in New thread backed by a pool of pre-installed worktrees, merged back on Done; for the shared-runtime clashes claims can't fix (card 🌳 Opt-in worktrees for isolated cards).
- `Done` **Changelog in the db** — every project's changelog in `~/.weft/changelog.jsonl`, mirrored to Supabase `changelog_entries`: threads add entries with `mcp__board__changelog_add` instead of editing CHANGELOG.md, entries link to their card, the card's commit stamps the sha, and Weft commits CHANGELOG.md itself right after, moving Unreleased under the version when a commit bumps it (docs/architecture/changelog.md).
- `P2` **Public changelog on weft.zip** — a project's released entries from `changelog_entries` as a page, and a "shipped" feed on the profile.
- `Done` **Review all** — a button at the top of the Review column starts the commit walk-through card, the same one the header's "+N/-N" counter starts (`lib/pile-review.ts`, `components/ColumnHeader.tsx`).
- `P1` **Per-card hunk commits** — the commit pile stages only a card's own hunks in a file two cards share (`git apply --cached`), so symbol claims don't fold two cards into one commit. Builds on symbol claims.
- `Done` **File overlap warning** — each card keeps the files its thread edited (Edit, Write, MultiEdit, NotebookEdit; `card.touchedFiles`, last 50), and when busy cards in one folder edited the same files the warning says so: "Also running here: Fix login — both edited a.ts" (`lib/overlap.ts`). It counts edits for the card's whole life, committed or not.
- `P2` **Worktree setup command** — a per-project command run in each fresh worktree (`npm install`, copy `.env.local`) before the thread starts.
- `P2` **Comment on the diff** — comments on diff lines go back to the thread as a reply, like a code review.
- `P2` **Merge and clean up** — when a card reaches Done, offer to merge its branch and remove its worktree.
- `P2` **Rebase button** — when the base branch moves, ask the thread to rebase and resolve conflicts.
- `P1` **Overlap warning** — flag when two running cards are editing the same files; tool items don't store file paths yet, so that comes first.
- `P2` **Rewind a turn** — use the SDK's file checkpoints to roll a card's files back to before a turn.
- `P2` **CI status on the card** — after a push, show GitHub checks; a failed check can send the card back to Needs you with the log attached.
- `P3` **Reviewer card** — spawn a second thread (another model or CLI) to review a card's diff and attach its findings to the original card.
- `P3` **Stacked cards** — chain cards so each branch builds on the previous one's.

## Agents, models and CLIs

- `Now` **CLI auto-login pop-up** — when Claude Code or puku-cli is logged out, run its login, show the output and login link in a pop-up, then let the card continue.
- `P1` **Model and effort per card** — pick the model and thinking effort when creating a card, and change them mid-thread. The model is done: the thread header's chip lists each CLI's models and swaps the open CLI's model in place. Still open: effort mid-thread.
- `Now` **Puku trial** — puku threads with no Puku account: signed in to Weft, a day-long trial token and puku-cli's `apiKeyHelper` route them through the deployed Weft's proxy (`/api/puku/v1`) to Puku on Weft's own key, metered per account per day in `puku_trial_usage` with a 429 over the cap (docs/architecture/puku-trial.md). Still open: a global cap across accounts.
- `Now` **Weft Pro (workspace billing)** — Free and Pro per workspace on `@aimhuge/billing` v0.5.0: Pro is $20/month or $200/year, replaces the Puku trial's daily cap with a 300M Puku token allowance (placeholder, in `lib/billing/plans.ts` `PRO_PUKU_TOKENS`), metered by `PlanMeter` in the Puku proxy with a 15 s cache and a free fallback on a billing outage. Settings → Accounts shows the plan and the meter, with **Manage billing** opening `/<slug>/billing` on weft.zip (Stripe Checkout for an upgrade, the Stripe-hosted portal to manage; owner or admin manages). Billing lives on the deployed Weft, on the shared AimHuge Stripe account with `app: "weft"`, and a webhook of its own (docs/architecture/billing.md). Each plan includes a BlastCP tier on the pricing page (`plan.blastcp`: Free → BlastCP Free, Pro and Team → Creator). Still open: tune `PRO_PUKU_TOKENS`; BlastCP honoring the bundled tier for a Weft-connected account; Checkout branding; one-off Puku credit grants (top-ups beyond the allowance).
- `Next` **Open Source, Education and regional pricing** — the free tier (`FREE_TIER` in `lib/billing/plans.ts`, the Puku trial cap, now 150 requests and 1M tokens a day) gains two $0 plans that unlock teams and BlastCP Creator but no tokens: Open Source (maintainers verified from GitHub at sign-in) and Education (the GitHub Student Developer Pack). Regional Pro sells Pro at $5 a month in low-income and $10 in lower-middle-income countries (World Bank groups; country from IP and billing address). Design in docs/architecture/billing.md.
- `Done` **Subagent tracking** — the CLI's task events (`task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed`) kept on the card as `card.tasks`: a strip above the reply box, a running count on the card, idle CLIs with background tasks kept open, and tasks cut off by a CLI exit named to the thread on its next message (docs/architecture/subagents.md). Still open: Codex sends no task events; a stop button per task (`stopTask`).
- `P1` **Finish puku-cli support** — run a full puku thread end to end, fix any SDK differences, and add it to the smoke test (it has only connected so far).
- `P1` **Login shell environment** — read PATH and env from the user's login shell at startup, so an app opened from the Dock finds `puku-cli`, `node`, `gh`, and project tools.
- `P2` **Per-project defaults** — default CLI, model, permission mode, and extra instructions per project folder.
- `P2` **Plan-first cards** — start a card in plan mode; its plan lands in Review with an "Approve and run" button.
- `P2` **Rate-limit handling** — recognize usage-limit errors, park the card with a "retry at" time, and resume it automatically.
- `P2` **MCP servers per card** — see which MCP servers a card loads and turn some off, to cut startup time and tool noise.
- `P2` **Role presets** — reviewer, tester, docs writer: short instruction add-ons you can pick per card.
- `P2` **Environment per card** — extra env vars per card or project (feature flags, test database URL).
- `P2` **Switch CLI mid-card** — hand a thread's summary to the other CLI when one is rate-limited or logged out.
- `P3` **Other CLI adapters** — a backend interface for additional CLIs outside the Agent SDK, such as Gemini CLI, to use the same thread view.
- `P3` **Cheap model for chores** — use a small model for titles, summaries, and digests instead of a full CLI thread.

## Copilot and orchestration

- `Done` **Threads can hand off work** — every board thread has `mcp__board__list_cards` (read-only) and `mcp__board__create_card` (starts in its own folder by default, records `parentId`); no move, stop, archive or read of other cards.
- `P3` **Show spawned cards** — use `parentId` to show which card started another on the board.
- `Done` **Copilot event feed** — with each of your messages the copilot gets a digest of cards that finished, need you, or failed since your last one (`lib/copilot-digest.ts`); no extra turns run.
- `Done` **Copilot lane** — the copilot left the card list for a lane on the right of the board: minimized it's a column (what finished, what needs you, its latest reply, an ask box), open it's a 520px chat over the hovercaddy cockpit while the columns narrow beside it; ⌘J and the ✨ button toggle it (`components/CopilotLane.tsx`, `lib/copilot-lane.ts`).
- `Done` **Copilot suggestions from the board** — a new copilot chat shows up to four chips Haiku writes from the open cards in full plus the pile, quality and scout, streak, Backlog, vault/webhook blanks, copilot history and chip clicks, Vercel deploys, Supabase migrations, GitHub PRs/issues and analytics setup; urgency-ranked, option meanings spelled out, refreshed in the background, covered starters hidden (`lib/copilot-suggest.ts`, `lib/copilot-context.ts`, `lib/copilot-sources.ts`). A chip about a card tells the copilot which card. Still open: real analytics numbers need a GA4/PostHog server key.
- `Done` **Copilot personas** — the lane header's name picks Wingman, Founder (founder-skill's business tests) or Captain (gstack's sprint); each persona's prompt joins the copilot's, its picture follows in the lane, and a switch starts a new chat (`lib/copilot-personas.ts`, `components/CopilotPersonaMenu.tsx`). Still open: your own personas, and a persona per project.
- `Done` **Copilot onboarding** — `lib/copilot-setup.ts` finds what isn't linked per project (Weft account, `gh`, Vercel, Supabase, Cloudflare, analytics); the chips offer one link, and the copilot's `setup_status` tool and prompt walk you through linking one step at a time.
- `Now` **Copilot hider** — the lane collapsed down to a 36px Intercom-style pill pinned to the right edge (the default), expanding to the 236px digest on demand (hover, click, or when the copilot has news) and the 520px chat on ⌘J. The board reclaims the 236px when the peek auto-closes 6s after the mouse leaves.
- `P1` **Copilot crew** — pick from several copilots in the top bar (Founder and Eng Manager from gstack, Marketer on BlastCP, Market Researcher on last30days), each a `persona.md` plus a `skills/` folder under `~/.weft/copilots/<id>/`, with its own pilot in the cockpit picture (renders in `~/.weft/show/copilot-cockpit/`).
- `P2` **Copilot acts on its own** — start a copilot turn when a card finishes or needs you, instead of waiting for your next message.
- `P1` **Away digest** — "what happened while I was away": a short per-card summary of results since you last looked.
- `P2` **Spec to cards** — paste a spec; the copilot proposes a set of cards with folders and order, and creates them after you approve.
- `P2` **Review triage** — the copilot reads finished threads and suggests Done, a follow-up reply, or a reviewer card.
- `P2` **Batch approvals** — approve "start these five cards" once instead of five separate prompts.
- `P2` **Reply drafts** — the copilot drafts the next message in a card's reply box for you to edit and send.
- `P2` **More board tools** — give the copilot tools for archive, labels, priority, fork, diff, and templates as those features land.
- `P2` **Copilot standing rules** — rules like "allow `npm test` on weft cards" that the copilot applies, listed and editable in settings.
- `P2` **Copilot memory** — keep your stated preferences across "New chat" resets.
- `P2` **Docked copilot** — an option to show the copilot as a side panel in the main window instead of a separate window.
- `P3` **Loop watcher** — the copilot notices a card repeating the same failing command and stops it with a note.
- `P3` **Voice input** — dictate to the copilot.

## Browser pane

- `Now` **Mini apps** — the pane's grid button saves its page as an app, a tile on the left rail below 🖥 Services; click to open it in the pane, right-click to rename, share, move, copy or remove; `~/.weft/apps.json` (`lib/mini-apps.ts`, `components/AppsRail.tsx`). My mini apps on the wefter profile (`components/LoomApps.tsx`) and **Share…** at `weft.zip/a/<id>` with a card's modes (`lib/app-share.ts`, `app/a/[id]`, `cloud_app_shares`). **Data apps** hold a folder (`~/.weft/apps/<slug>/`, `weft-app.json`), ask for one vault env with Touch ID and read through Electron main (Supabase functions, GA4), and every app is persisted on prod (`cloud_mini_apps`, `lib/app-cloud.ts`, `electron/app-data.cjs`); 📈 Growth is the first. **React apps** (a folder with `App.tsx`, bundled by Weft with its own React, rebuilt on save) and **hosted links** under their owner, `weft.zip/@you/apps/<slug>` or `weft.zip/<team>/apps/<slug>`, serving the whole folder in a sandbox, and **link previews** for public links (title, description and a branded card with a capture of the app, from `weft-app.json`, the page's meta tags or Haiku; `lib/app-preview*.ts`, `/api/a/[id]/og`); apps reach other services through `weft.fetch` with `{{secret:NAME}}` placeholders, the author's or each viewer's own key, encrypted on weft.zip under `WEFT_MINIAPP_KEY` (`cloud_app_secrets`, docs/architecture/mini-app-hosting.md). Next: npm dependencies for React apps, pinning the outbound connection to the checked address, show the visits and fetch log, `mcp__browser__save_app` so a thread can offer its page as an app, drag to reorder, favicons, revoke from the tile's menu, full Next.js apps on Workers for apps that need server code.
- `Now` **Editor column** — click a file path in the thread (or ⌘P) to open it beside the thread: CodeMirror, TipTap markdown that saves only what you changed, a Changes view vs. HEAD, live reload and save conflicts; inline diffs on Edit/Write rows (docs/architecture/editor.md). Next: take a symbol claim while a file is open, the web board.
- `Now` **Show rail** — a 72 px column right of the page: one mini per turn of the open thread (dot, first words, relative time) and per page the pane showed (the agent's `open_url` calls, and pages you opened this session) as a small picture of the page (`lib/page-shots.ts`), click to scroll the chat there and put the pane back on that turn's page; chat scrolling lights the turn on top and the pane follows it to its page (`lib/use-pane-follow.ts`); hidden under 980 px (`lib/show-rail.ts`, `components/ShowRail.tsx`). Next: keep hand-opened pages across a restart, capture pages of cards that aren't open, prune shots of deleted cards.
- `Now` **Always show something** — a working page in a card's blank pane when a turn starts (the card's own hovercar scene, dimmed, with the title, ask and a running clock), and a Haiku-written update page (how it's going, what we did, what's next) after any turn that showed nothing (`lib/glance.ts`). Measured 2026-10-10: Haiku with a bare CLI ~8-15s and steady; puku-ai-2.8 similar but 8-31s; Haiku via plain `claude -p` 18-45s from startup.
- `Now` **Card pages survive a restart** — each card's last page is saved to `~/.weft/pages/` (temp pages copied) and comes back when you open the card (`electron/pane-pages.cjs`).
- `Now` **Failed loads say why** — Weft's own error page instead of Chromium's blank one, with Try again, Back to the card's last page, and auto-reload when a local dev server comes back (`electron/pane-error.cjs`).
- `P2` **Page history and cloud sync** — every page a card showed as a timeline, synced to Supabase (Postgres `card_pages` + Storage, R2 later if egress costs), with share links.
- `Now` **Page zoom** — a % button in the pane's toolbar (steps, presets, Actual Size), ⌘+/−/0 and ⌘+scroll on the page in Chrome's steps, and pinch to magnify (`electron/browser-pane.cjs`).
- `Now` **Board view for threads** — `mcp__board_view__*` screenshots, clicks, hovers, types into and reads Weft's own board window, so a thread that changes a drawer or dialog checks it in the real app; fixed operations only, secret values redacted (`electron/board-view.cjs`, docs/architecture/board-view.md).
- `P2` **Fit to pane** — one click to fit a large image or a fixed-width page to the pane's width.
- `P2` **Show switch and model** — a Settings toggle for the update page, and a choice of model.
- `P1` **Browser tab per card** — each card drives its own tab, and the pane shows the selected card's tab; today one page is shared by all cards.
- `P1` **Console and network tools** — let agents read console errors and failed requests from the pane, which is most of what debugging a dev server needs.
- `P1` **More input tools** — scroll, press a key, hover, select an option, and wait for an element, alongside `click` and `type_text`.
- `P2` **Structured page snapshot** — an accessibility-tree snapshot with element refs, so clicks don't depend on guessing CSS selectors.
- `P2` **Who's driving** — show when an agent is controlling the pane, and pause agent actions while you type in it.
- `P2` **Pick an element** — click something in the pane to send its selector and a screenshot to a card's reply box.
- `P2` **Dev server per card** — start a card's dev server in its worktree on a free port and open it in that card's tab.
- `P2` **Viewport sizes** — phone and tablet sizes for the pane, also available to agents as a tool.
- `P2` **Cookie profiles per project** — separate browser storage per project instead of one shared `persist:threadboard-browser` profile.
- `P2` **Navigation allowlist** — limit agent navigation to localhost and listed domains per project.
- `P3` **Pop-out pane** — move the browser into its own window, for a second monitor.
- `P3` **Session recording** — record what an agent did in the pane and attach it to the card for review.

## Permissions, safety and sandboxing

- `Done` **Default permission mode** — set in Settings (Auto out of the box); the new-thread dialog, the API, the copilot's `create_card` and warm spares all start in it.
- `Done` **Switch a card's permission mode** — from the thread header or the card menu, applied to the running CLI; picked-up Claude Code sessions keep the mode they last ran in.
- `P1` **Always-allow rules** — "allow always for this card / this project" on a prompt, saved as tool-plus-pattern rules you can edit in settings.
- `P1` **Full request detail** — expand a pending request on the card to see the whole command, the file diff for an edit, or the full URL before answering.
- `P1` **Deny with a reason** — deny and tell the agent what to do instead, rather than the fixed "The user denied this in Weft."
- `P2` **Permission inbox** — one list of every pending request across cards, answerable from the keyboard.
- `P2` **Queued requests on the card** — parallel tool calls queue up; show how many are waiting and allow answering them together.
- `P2` **Danger highlighting** — mark `rm -rf`, force pushes, writes outside the project folder, and installs from unknown sources in the prompt.
- `P2` **Folder boundary** — prompt or block when a card edits files outside its folder or worktree.
- `P2` **Sandboxed cards** — run a card under the CLI's sandbox or in a container, and require it for auto permission mode.
- `Done` **Secrets vault (local)** — 🔐 on the rail: a vault per repo, encrypted in Electron main, `.env` import with a preview, a nudge for `.env.local`, Touch ID to reveal or copy.
- `Done` **Vault: every project, by hand** — the drawer holds every board project's vault behind a project filter that follows the top bar (overridable); Add and Change Value… type secrets in without a `.env` file; Copy to <project> copies one between vaults in main.
- `Done` **Vault: add a secret by key** — Shift+`S` (also in the ⌘K palette and the `?` sheet) opens the 🔐 drawer on its Add form.
- `Done` **Vault: threads fill fields** — `mcp__secrets__list` (names only) and `mcp__secrets__fill_field` (Touch ID per card and site, then main types the value into the pane, masked, read back as `‹NAME›`).
- `Done` **Vault: values for commands** — `mcp__secrets__run`: approve the exact command and names (once or always), main runs it with no shell and the values in its env, output redacted to `‹NAME›`; dev servers get development values; a secrets-using card's stored tool results are redacted.
- `Done` **Vault: threads ask for a missing key** — `mcp__secrets__ask_add` shows an input for the key in the thread itself (name filled in, paste the value, Add to vault tells the thread); `fill_field` / `run` on a missing name add blanks and point at it.
- `Done` **Vault: blanks are the default** — `mcp__secrets__add_blank` is the default for a key a thread needs but isn't blocked on, with a hint for where to get the value; blanks sort first, the rail's badge counts them, every blank row has a visible **Fill in** button with the hint under the name, the right-click menu's **Set Value…** becomes **Fill In Value…**, and the Add form's button reads **Add blank / Add N blanks**. `mcp__secrets__ask_add` is the urgent path, an input in the thread.
- `Done` **Webhooks on the rail** — 🪝 under 🔐: threads record each webhook route (`mcp__webhooks__add_blank`, `ask_add`), blanks counted until registered; a relay URL on the deployed Weft forwards deliveries to the local dev server through Supabase Realtime (`mcp__webhooks__relay`; docs/architecture/webhooks.md).
- `P2` **Webhooks: replay and test** — resend a recent delivery, or send a sample one, to the local route from the drawer.
- `Now` **Teams** — workspaces on weft.zip: every account gets one, owners and admins invite by email, roles, a workspace shell for Team and Billing; desktop entry in the account menu (docs/architecture/teams.md). Still open: apply the migration, add the weft.zip callback URL in Supabase Auth, a deploy.
- `Next` **Shared team vault** — a workspace's 🔐 vaults shared end to end encrypted: device keys, per-device grants, ciphertext sync, fingerprint check on a new teammate (docs/architecture/teams-vault.md).
- `P1` **Vault: values for API calls and requests** — a header or body value for an HTTP request a thread makes (Supabase Management API), and `mcp__secrets__request` (Needs you with a paste field).
- `P2` **Vault: remembered approvals in the drawer** — list and remove the commands set to Always allow; patterns like `npm run job:*`.
- `Done` **Vault: `.env.local` written back** — Weft writes the file from the vault with a `# Managed by Weft` header and watches it for hand edits.
- `Done` **Account token behind safeStorage** — the Supabase session lives in `~/.weft/account.sealed`, sealed by Electron main; the server reads it through main.
- `P2` **Secret masking** — hide tokens and `.env` values in thread views, tool output, and exports.
- `P2` **Audit log** — an append-only record of every allowed and denied tool call: card, time, and whether you or the copilot answered.
- `P2` **Per-launch API token** — require a token on `/api` in addition to the host and header checks, since any local process can call it today.
- `P3` **Permission timeout** — auto-deny a request after a set time and notify you, so a forgotten prompt doesn't hold a CLI open indefinitely.

## Speed and reliability

- `Done` **Faster home-page builds** — bundle the board and home page's fonts locally, including the social preview's TrueType
  face, and cap the GitHub release-feed lookup at three seconds.
- `Now` **Warm, pre-started CLIs** — keep a spare CLI loaded per project so a new card's first turn skips the 12–50 s wait for MCP servers, plugins, and hooks.
- `Now` **Error boundaries** — each card, the thread, the browser pane, the rail, the terminal and the footer sit in their own boundary (`components/CrashGuard.tsx`), and so do smaller pieces: every dialog's body (its header and ✕ stay), each rail drawer, each header badge, the Copilot and account buttons, the project bar, the New thread dialog, and inside a thread each message and tool run, the reply in progress, the permission request, the review panel and the reply box (small spots get an inline chip with the error on hover); Board's pieces, the header badges, the reply box and the review panel load through `guarded()` (`components/guarded.tsx`), so a module that throws while loading is caught in its spot too, and `app/error.tsx` hides the browser pane so its message shows, with `app/error.tsx` and `app/global-error.tsx` behind them, so a thread's half-written edit breaks one piece, not the whole board. A build error, which no boundary can catch, swaps Next's overlay for a small bar over the last version that built (`components/BuildErrorBar.tsx`). At startup a failed load or a crashed renderer shows the start screen's error with Retry (`electron/startup-screen.cjs`).
- `Done` **Import guard** — a build error is past any boundary (nothing compiles), so a PostToolUse hook on every thread (`lib/import-check.ts`, in `guardedCli()`) reports imports an edit just broke: an export removed that another file still imports, or a name or module that isn't there. ~20ms per edit, text matching, no type-checker. Came from a star+tag card whose parallel subagents removed `starMenu` while the board still imported it.
- `Done` **Restart guard** — every restart of Weft's server cut off every running card (10 launches and ~30 dropped cards in four days, some from threads running `kill -9` on the server). A PreToolUse hook (`lib/restart-guard.ts`, in `guardedCli()`) denies Bash that would kill Weft's server, app or port, or start a second Weft in its folder, while other turns run, and tells the thread how many it would cut off and to ask you; the thread prompt says the same. A CLI that keeps working after its turn ended now shows Running, so the restart recovery catches it.
- `Done` **Restart when idle** — arm a restart from the Weft menu, the command palette, the updater or a thread (`mcp__board__restart_weft_when_idle`, approved by you); nothing new starts, messages sent meanwhile wait on their card as "after restart" and go out once Weft is back, and Weft relaunches (or installs the update) when the last running turn and queued follow-up end (`lib/restart-when-idle.ts`, `electron/restart-when-idle.cjs`, the header's ⟳ chip). Next: a Keep Working-style menu bar state while armed.
- `Now` **Startup timer** — each launch's phases are saved to `~/.weft/startup.jsonl` (`electron/startup-timer.cjs`), and a launch well over the usual time shows a toast naming the slowest phase (`lib/use-startup-check.ts`). On 2026-10-11 two changes came out of it: the login-shell PATH (~1s of `zsh -ilc`) is now saved and refreshed in the background, and `.next` is kept between launches, along with Turbopack's cache, unless a stale server had to be killed.
- `P1` **Crash-safe storage** — write `board.json` and thread files to a temp file and rename, and keep a rolling backup, so a crash mid-write can't lose the board.
- `P1` **Concurrency cap and run queue** — limit how many cards run at once; extra starts wait and begin in priority order.
- `Done` **Resume after restart** — a card that was running (or waiting on a permission) when the app closed carries on by itself after the restart: `lib/store.ts` marks it `interrupted` on load and `lib/resume.ts` sends its session a "Weft restarted, pick up where you left off" turn. Up to three carry-ons in a row (`resumes`), so a turn that keeps getting cut off stops for Resume all.
- `P2` **Append-only thread files** — threads are rewritten in full on every new item; switch to append-only JSONL so long threads stay cheap.
- `P2` **Paged thread loading** — load the last N items when opening a card and fetch older ones on scroll.
- `P2` **Event replay on reconnect** — number SSE events and replay missed ones, instead of reloading the whole board after every reconnect.
- `P2` **Process monitor** — show each open CLI's memory and CPU, close idle ones, and cap the total number of warm processes.
- `P2` **Stuck-turn detection** — flag a card that has produced nothing for N minutes and offer stop or retry.
- `P2` **Per-card logs** — keep each thread's CLI stderr in a log you can open from the card, not only in the app's console.
- `P2` **Diagnostics panel** — CLI paths and versions, login state, MCP startup times, port, and data folder size in one place.
- `P3` **Board file versioning** — a schema version in `board.json` with migrations, so updates never break a saved board.

## Notifications and presence

- `Now` **Desktop notifications** — a native notification when a card needs you, finishes, or fails; clicking it opens the card.
- `P1` **Dock badge** — the Needs you count on the Dock icon, so you can tell at a glance whether anything is waiting.
- `P2` **Menu bar list** — a menu bar icon listing cards that need you, with Allow and Deny right there.
- `Done` **Keep Working** — the menu bar icon's switch for staying awake with the lid shut (`pmset disablesleep` behind a one-time sudoers rule). It runs until threads finish or for 1/2/3/8 hours, and a watchdog puts sleep back at the deadline, at 10% battery, or if Weft dies (`electron/keep-working.cjs`). Settings → Laptop mode has the same choices plus **Always while threads run** (turns it on whenever a card is running), **Only while online**, and a battery floor you pick.
- `Done` **Trusted folders** — the folder guard's **Always** answer used to be a one-way door: `settings.allowedFolders` was written and nothing ever showed it or took a folder back out. Settings → General now lists it (`allowedFolders` rides along in `SettingsView`, so it costs no request): **Add folder** opens the OS dialog (`window.weft.dialog.openFolder`, the one the project and repo pickers use) and grants through the same `POST /api/folders` **Always** calls, **Remove** is `DELETE /api/folders` → `unallowFolder` (`components/TrustedFolders.tsx`). A revoke applies to new work; a card already holding the folder keeps it until that turn ends. Not covered: Codex threads, the copilot and the macOS layer (docs/architecture/thread-guards.md).
- `Done` **Sign-in expiry** — Settings → Accounts lists how long each saved sign-in lasts, so a lapsing sign-in is found in Settings rather than when a thread trips over it. BlastCP's 30-day grant is the one that runs out and speaks up in its last week (reusing its drawer's `expiryNote()` and the `expiresAt` main already bridges); Vercel, Supabase and Cloudflare say "No expiry" rather than sitting blank. Only the expiry crosses from Electron main, and nothing re-consents quietly on your behalf (`components/TokenExpiry.tsx`).
- `P2` **Unread dots** — a dot on cards with new output you haven't opened.
- `P2` **Notification rules** — choose per project which events notify you, plus quiet hours.
- `P2` **Answer from the notification** — Allow and Deny buttons on the notification itself.
- `Now` **Sounds** — a chime when a card moves to Running, Needs you, Review, or Done, or hits an error; moves you make stay quiet, and Settings has on/off, volume, and a toggle and preview per chime. The sounds are CC0 vibraphone samples in `public/sounds/`.
- `Now` **Unseen highlight** — a card that moves to Needs you, Review, or Done without you (the same moves that chime) gets an accent tint and a pulsing dot until you open it.
- `P3` **Batched notifications** — hold notifications during focus time and deliver them every N minutes.

## Remote and mobile access

- `P2` **Phone view** — a mobile board over a private tunnel (Tailscale or a paired relay) to answer permissions and reply away from the desk.
- `P2` **Phone push** — push "needs you" to your phone (ntfy, Pushover, or a native app).
- `P2` **Device pairing** — pair a phone with a QR code and a device token, since the API only accepts localhost today.
- `P3` **Chat bridge** — answer permissions and send replies through a messaging app.
- `P3` **Headless server mode** — run the board without Electron on an always-on machine and open it from any browser.
- `P3` **Remote runners** — run a card's CLI on another machine or a cloud VM while the board stays on your laptop.

## Collaboration

- `P2` **Project config file** — a `.weft.json` in a repo with default CLI, setup command, templates, and allow rules, shared by everyone who clones it.
- `P3` **Hand off a card** — export a card and its session so a teammate can resume it on their machine.
- `P3` **Shared board** — sync one board between people; each card shows whose machine is running it.
- `P2` **Server-side cards** — built (docs/architecture/cloud-sync.md): Settings → Sync uploads opted-in projects' cards and threads to the
  workspace, and `weft.zip/<workspace>/board` shows them live, read-only, in the desktop's own window (header, rail, `BoardColumn`, `CardView`, project bar, filter, and a card framed with its thread and browser pane), and **New thread** on the web board starts a card on your Mac (`cloud_commands`, `lib/cloud-inbox.ts`); the open card is the desktop's own thread panel over a cloud transport (`lib/thread-transport.ts`): its reply box sends a `reply` command the Mac runs as if typed there, a waiting question or permission is answered with an `answer`, ■ sends a `stop`, and a turn's items reach the web within a second. Next: seal item bodies with the workspace key, the assistant's text as it streams, pasted images from the web (an upload on the transport), the share view and New thread dialog on the same seam, and maybe session logs so another Mac can carry a thread on.
- `P3` **Card comments** — notes from teammates on a card that the agent doesn't see.
- `Now` **Public profiles** — `weft.zip/@username` (rewritten to `app/u/[username]`): picture, name, GitHub link, member since, your public share links and mini apps, and the whole Wefter Profile your Mac posts to `profile_cards` (level ring, class, bio, league rank, XP, streak, badges, attributes, skills, cloth, tokens, records; `lib/profile-card.ts`); `profiles.username` from the GitHub login (docs/architecture/profiles.md). Next: edit your username and a bio, opt out of listing a share, a per-profile title and OG image, a link to it from the workspace header.
- `Now` **Share a card** — **Share…** on a card makes `weft.zip/s/<id>`: the thread and its browser pane side by side, live (polled every 4 s), private / public / email / password from `@aimhuge/share` v0.8.0, pages sandboxed, keys masked, long tool outputs left out (docs/architecture/sharing.md). **Share the board** (the icon beside your avatar, its menu, ⌘K, and **Share** on the weft.zip board) gives the workspace's web board link and invites by email: an existing account joins at once, anyone else gets a sign-up invite (`components/ShareBoardDialog.tsx`, `components/web-board/WebShareBoard.tsx`). Next: a visits list for the owner, expiry, sealed item bodies, a show page's own images.

## Cost and analytics

- `Not planned` **Cost totals** — Weft runs on a Claude subscription, so dollar estimates are hidden everywhere (cards, threads, copilot, recipe pages); cost is still recorded per card.
- `Done` **Prompt cache warmth** — the status strip's `cache:52m` counts down how long the thread's prompt cache stays warm after its last request (1 hour or 5 minutes, read from what the request wrote), then turns to `cache:cold 120k`: the next message sends that many tokens again at full price, a bigger bite of the 5-hour limit. Its tooltip gives the last request's cache hit share (`lib/turn.ts` `cacheAfter`, `CardStats.cache`). A cold thread over 30k tokens makes **Send fresh** its default: a new session in the same card, started from a brief (Haiku summary written ahead of time, what's open, the diff of its own edits; `lib/splice.ts`, `lib/splice-brief.ts`, `lib/splice-diff.ts`, `POST /api/cards/[id]/fresh`), with "Send with full history" in the send menu (`lib/reply-mode.ts`). Threads run with a 1-hour cache TTL (`lib/env.ts`).
- `Done` **Limits chart** — hovering the status strip's `5hr` / `7d` shows the week from one weekly reset to the next: 168 green hour bars of the 5-hour limit left (left axis), 7 see-through red day bars of the weekly limit left in front (right axis) with burn-down tops, red lines at hits, green lines at 5-hour resets (light), the next one (strong) and the weekly reset (strongest). Threads ask for their limits after each turn (every 5 minutes at most) and log changes to `~/.weft/limits.jsonl` (`lib/limit-history.ts`, `lib/limit-chart.ts`, `/api/limits`, `components/LimitBurndown.tsx`). Next: a projection of when the weekly limit runs out at the current pace.
- `Done` **Status strip by thread and plan** — the strip splits into the open thread's numbers (`[cli · model]` from `runsOn`, context, cache, tokens) and each CLI's plan limits, read from `~/.weft/limits.jsonl` rather than the card's own snapshot, so every card on a CLI agrees and a passed reset reads full; with no card open the footer lists each CLI's plan instead of copying the last-changed card. A CLI switch clears the old session's numbers (`lib/plan-limits.ts`, `lib/use-plan-limits.ts`, `app/api/limits/plans`). Next: say how long ago a plan was read, and whether puku-cli reports its plan's limits at all.
- `P2` **Budgets** — a spend cap per card or per day; the card pauses and asks when it reaches it.
- `P2` **Token usage per turn** — input, output, and cache tokens from each turn's result, to spot threads that reread too much.
- `P2` **Plan usage** — for Claude subscriptions, show remaining session and weekly usage so you know when a limit is coming.
- `P2` **Flow stats** — cards finished per day, time spent in each column, and total time cards waited on you.
- `P3` **Spend by CLI and model** — compare Claude and puku cost for similar kinds of tasks.
- `P3` **CSV export** — card history with cost, turns, and durations.

## Progress and gamification

- `Done` **Streaks, XP, badges and the builder card** — the header's 🔥 chip and "Your loom" dialog: XP that pays shipping (and healthy code) over volume, streaks with freezes, 40 badges, eight attributes and a class, stack skills, the activity cloth, personal records (`lib/game*.ts`, `lib/activity.ts`, docs/architecture/gamification.md).
- `Done` **Tokens and plan-limit hits** — the Wefter Profile's 30-day token chart with 5-hour and weekly limit hits, read incrementally from every Claude Code and puku-cli transcript, plus the ⏳ Hit the ceiling and 🗓️ Ran the week dry badges (`lib/usage.ts`, `lib/usage-scan.ts`, `components/LoomUsage.tsx`).
- `Done` **Production-ready tree** — per-project testing, security, observability, docs and delivery checks read from the repo, each with "Set it up" to start a card (`lib/project-checks.ts`, `lib/project-badges.ts`).
- `Done` **Leagues** — weekly leagues of up to 30 by XP, top 7 up and bottom 5 down, with each builder's week (shipped, streak, level, badges) and a link to their `weft.zip/@username` (`lib/league*.ts`, `components/LeagueTab.tsx`, docs/architecture/gamification.md). The header's 🏆 chip opens every league, any tier, with who's in each (`components/LeaguesDialog.tsx`, `league_browse`).
- `Done` **League emails** — a welcome on day one, Thursday and Sunday nudges when a move is in play, Monday's results; one-click unsubscribe (`lib/league-mail*.ts`, `app/api/league/emails`, docs/architecture/gamification.md).
- `P2` **League results** — a Monday toast "You moved up to Linen" and last week's final table in the app (the email already says it).
- `P3` **`weft://league` opens the League tab** — today the emails' button only brings Weft forward.
- `P2` **Daily quests** — three small goals a day ("Ship 3 cards", "Clear Needs you") with bonus XP.
- `P2` **Weekly recap** — on Monday the browser pane opens "Your week in Weft": shipped, projects, streak, new badges.
- `P2` **What you build** — Haiku tags each shipped card with a domain (Payments, AI agents, Decks) for the builder card.
- `P2` **Audit clean** — an `npm audit` check (no high or critical) in the Security branch, run at most daily.
- `Done` **GitHub profile on your wefter card** — the Loom's You tab shows your GitHub picture, @login, bio and stats through `gh api user` (`lib/github-profile.ts`).
- `P3` **Public builder card** — your profile beside your name in a league, shareable as an image; find collaborators by class and stack.
- `P3` **Weft Wrapped** — a year-in-review page and image.
- `P3` **Efficiency and test-first badges** — ship under $1, a 95% cache hit week; a card that edited the test before the code.

## Search and memory

- `P1` **Search** — ⌘K search across card titles, prompts, agent replies, and tool commands.
- `P2` **Command palette** — the same ⌘K box runs actions: new card, switch project, toggle browser, open settings.
- `P2` **Done summaries** — a one-paragraph summary saved when a card reaches Done, used by search and digests.
- `P2` **Project memory** — per-project notes added to every card's instructions in that folder, or a quick editor for the repo's `CLAUDE.md`.
- `P2` **Related cards** — while writing a new card, show past cards in the same folder with similar prompts.
- `P3` **Semantic search** — find "where did we fix the SSE reconnect" by meaning, not exact words.
- `P3` **Lessons capture** — on Done, ask the thread for lessons worth keeping and add them to project memory after you approve.

## Integrations

- `Done` **Sign in on weft.zip** — the deployed site has a real `/login` page (`app/login/page.tsx`,
  `lib/auth/`) with **Continue with GitHub** (no Google, no magic link on the new page). A signed-out
  visit ends in a Weft account without the desktop app; a signed-in visit lands on `/app`, a small
  "you're in" card with the download CTA. The board's top-bar sign-in, Settings → Weft account, and
  the Puku-trial upgrade prompt keep the same flow. `app/api/auth/callback` (GET) and
  `app/api/auth/weft-callback` (POST) replace the old `app/api/account/*` JSON surface. The hook
  lives in `lib/auth/hooks.ts:useAuth`, a thin wrapper whose public API mirrors `@aimhuge/auth`;
  swapping to the package upstream is a one-line import change in `lib/auth/index.ts`.
  `safeNextPath` rejects open-redirect tricks on `?next=`. Home page has a **Sign in** link in the
  nav when signed out, hidden when signed in.
- `Done` **Email at weft.zip** — Resend receives every mail to the domain and the deployed Weft forwards it to one inbox (`lib/email-forward.ts`, `app/api/email/webhook/route.ts`, docs/architecture/email-forwarding.md). Vercel DNS holds DKIM, both SPFs, the MX and a DMARC record (`p=none; rua=mailto:dmarc@weft.zip`, monitor-only; tighten to `quarantine` after clean reports); Resend's webhook at `https://weft.zip/api/email/webhook` is signed and live; the forwarder is verified end-to-end (a `*@weft.zip` mail round-trips to `EMAIL_FORWARD_TO`). Still open: per-alias routing, attachments over Resend's 40 MB.
- `Now` **GitHub Issues sync** — in phases (docs/architecture/github-issues.md):
  - `P1` Phase 1, card → issue: make an issue from a card, its tags as labels, and link the two.
  - `Done` Phase 2, issues → cards: ⌘K "Import GitHub issues into <project>" opts a folder in; its open issues become Backlog cards through `gh` (body + link + "Fixes owner/name#N" as the prompt, labels as tags), re-checked every 5 min. A closed issue archives its card if it never started; started cards are never touched; a deleted card stays deleted (`lib/github-issues.ts`).
  - `Done` Instant sync by webhook: a repo webhook posts to `/api/github/webhook` on the deployed Weft (Vercel), which saves a `github_events` row the server hears through Realtime and syncs that repo (`lib/github-hooks.ts`). The poll stays as the fallback.
  - `Done` The GitHub drawer on the left rail: the `gh` sign-in, and per project its repo, the issue sync switch, the last sync, Sync now (`components/GithubDrawer.tsx`, `lib/github-status.ts`).
  - `P2` Phase 3, two-way: title, labels and open/closed kept in step both ways.
  - `P2` Phase 4, Projects v2: a GitHub Project's Status column follows the card's column.
  - `P2` Phase 5, comments: a turn's summary posted to the issue (summaries only, vault values removed, a warning on a public repo).
- `P2` **PR review comments back to the card** — new review comments on a card's PR show up as a reply draft on that card.
- `P2` **Open in editor** — open a card's folder or worktree in VS Code, Cursor, or Zed, and jump to a file and line from a tool row.
- ~~`P2` **Open in terminal** — open a terminal in the card's folder or worktree.~~ Shipped as the terminal drawer (Control-backtick as in VS Code, or `t`): a shell per folder that follows the open card or selected project, split side by side up to three (⌘\\).
- `P2` **Packaged terminal** — `node-pty` ships in the packaged app's Electron bundle; still to come: a way to close idle folders' shells.
- `P2` **Board CLI** — `weft add "fix the flaky test" --cwd .` to create cards from a terminal or script.
- `P2` **Linear** — create cards from Linear issues and keep issue status in step with the card's column.
- `P2` **Slack** — post Done and Needs-you summaries to a channel, and create cards from a slash command.
- ~~`P2` **BlastCP queue on the rail**~~ Shipped as the BlastCP rocket on the rail: connect with OAuth, link a property per project, see its next posts, drafts and failures, open them in the pane; the picker can also make a new property. Since 2026-10-23 it connects with your Weft account (token exchange, account made on first connect, self-renewing). Next: draft a post from a card, and a rail badge for posts waiting on you.
- ~~`P2` **Link a Vercel project**~~ Shipped as ▲ on the rail: token in the Keychain, link an existing project or make a new one (with its GitHub repo connected), see the latest deploy. Next, in the same drawer: connect GitHub on an already-linked project, deploy and redeploy, and build and runtime logs. Built: push 🔐 vault values to Vercel environments, from the drawer or a thread (`mcp__secrets__push_to_vercel`), Touch ID per push, or **Push all** behind one Touch ID. Built: pull plain Vercel variables the vault has no value for, by hand or live through a team webhook relayed by the deployed Weft (`lib/vercel-hooks.ts`).
- ~~`P2` **Link a Supabase project**~~ Shipped as the bolt on the rail: token in the Keychain, link a project (or pick up `.mcp.json`'s), see its state, region, unapplied migrations, Restore a paused one. Migrate shipped 2026-10-13 (a card that applies pending migrations on your OK; a migration applied under another version now counts as applied). Next: copy the URL and keys into the 🔐 vault, add the Supabase MCP server for threads. Create a project in place shipped too (+ New project in Link…, password into the vault).
- ~~`P2` **Link a Cloudflare project**~~ Shipped as the orange cloud on the rail: API token in the Keychain, link a Worker or Pages project (best fit from the folder's wrangler config), see its address, latest deploy and where it deploys from. Next: write `account_id` for wrangler, push 🔐 vault values as Worker secrets, tail logs, zones and DNS.
- `P2` **Vercel previews** — after a push, open the preview deployment in the card's browser tab and save the URL on the card.
- `P3` **Sentry** — create a card from an error with its stack trace and a link back.
- `P3` **Jira and GitLab** — the same issue and PR flows for teams on those tools.
- `P3` **Incoming webhook** — a token-protected local endpoint that creates cards from scripts, such as a CI failure.

## Settings and onboarding

- `Now` **Settings dialog** — one place to edit the thread prompt, how long idle CLIs stay open, recent projects, and CLI login state. It fills the window over a scene: General, Models, Threads, Automations, Shortcuts and Accounts down the left as pages of frosted cards, Models holding every model pick, and a dot on any page with edits waiting for Save.
- `Now` **Subagents** — every thread is told when to delegate to subagents, and Settings → Models → Use for subagents picks their model from every model either CLI serves (grouped Claude / Puku), let the model choose (with a Haiku / Sonnet / Opus guide), or the thread's own; the other CLI's models run as a headless `-p` subagent (`lib/subagents.ts`).
- `Done` **Stop a task; dev servers in their own list** — a ■ Stop on each running row of the thread's task strip (`query.stopTask`, `lib/task-stop.ts`); the rail's 🖥 drawer lists every dev server (Weft's own from `mcp__devservers__start` and review tours, plus ones threads ran in the background), with Open, Restart and Stop (`lib/devserver.ts`).
- `Done` **Services drawer** — the 🖥 drawer became Services: every process Weft spawned (thread CLIs by card, dev servers, terminals, other commands) from one `ps` of the tree under Electron, with CPU, memory, per-process rows, End and a refresh-rate picker (`lib/services*.ts`, `app/api/services`, `components/ServicesDrawer.tsx`).
- `Done` **Dev servers in Services** — a section at the top of the drawer finds each working folder's dev command (package.json scripts with the lockfile's runner, Procfile, Rails, Django, deno, Makefile, wrangler) and starts, stops or restarts it, saying which, when and by which card (a click opens it), and thread names in the list open their cards (`lib/dev-commands.ts`, `lib/dev-launchers.ts`, `components/DevLaunchers.tsx`).
- `P2` **Live subagent progress** — show what a running subagent is doing under its line in the thread; today its messages are dropped until it reports back (`lib/runner-turn.ts`).
- `Now` **Weft account** — optional sign-in: a GitHub "Sign in" button in the top bar right of Copilot (your avatar once signed in, `components/AccountButton.tsx`), and Settings → Weft account with GitHub, Google or an email link, against the Weft prod Supabase project (`lib/account.ts`, `components/AccountSettings.tsx`). PKCE in the system browser, back to Weft on `weft://account-callback` (the loopback `/api/auth/callback` in plain `next dev`); the session lives in `~/.weft/account.json` (0600). The deployed site has a real `/login` page (`app/login/page.tsx`, `lib/auth/`) so a visitor can sign in without the desktop app first. First real GitHub sign-in verified 2026-10-12: one user, one profile row. A `profiles` table with row-level security is filled on first sign-in (`supabase/migrations/`). Nothing uses the account yet: it's the base for page sync, share links and shared boards.
- `Done` **Welcome on first launch** — two screens before any session becomes a card: the Wefter Profile your Claude Code history makes, with where it came from (Opt out / OK), then the projects to bring in, scratch and worktree folders unticked (Start fresh / OK); existing boards are adopted silently; Settings → General has Count my Claude Code history, Bring them in and Test it; Replay the welcome is in the avatar menu and palette (`lib/welcome.ts`, `lib/welcome-preview.ts`, `components/WelcomeDialog.tsx`). Coach tips: an empty board's start panel and one-time tips under Needs you, Review and Done, the last opening the Wefter Profile, with Reset tips in Settings (`lib/tips.ts`, `components/OnboardingTips.tsx`). Get ready plays a HyperFrames loop of the board at work with your project names (`public/welcome/loop.html`, `components/WelcomeLoop.tsx`), and `pnpm welcome:render` makes its MP4 plus a 48-second weft.zip tour (`public/welcome/beats.html`: connect your tools, the profile, code quality). Next: coach-tip clips, a "make a launch video" starter, a shareable first-thread recap, the "What Weft knows" page, anonymous telemetry's first-launch notice.
- `P1` **First-run check** — on first launch, check for `claude` and `puku-cli`, their login state, and `git`, then pick a first project folder.
- `P2` **Guided first card** — a starter card in a scratch folder that shows Running, Needs you, Review, and the browser pane in a couple of minutes.
- `P2` **Data folder in settings** — choose where the board is stored from settings instead of the `WEFT_DATA` variable.
- `Now` **Shortcuts sheet** — `?` lists every keyboard shortcut (board, composer, terminal, app menu), searchable by words or keys; hold ⌘ or ⇧ for a cheat card; tooltips, the filter box and right-click menus show keys.
- `P2` **Export and import settings** — move the thread prompt, templates, and rules to another machine as one file.
- `Now` **Theme** — light, dark, or follow the system, from Settings → Appearance; the desktop window chrome follows it too.
- `Now` **Scene themes** — Twin Suns, Canyon, Coast Road, Neon City, Snow Pass, Cockpit and Salt Flats: Weft's own pictures behind the board, each with a palette drawn from it and clear columns (Settings → Appearance, or ⌘K "Theme: …"). The first launch picks one for you: Twin Suns in dark mode, Salt Flats in light.

## Packaging, updates and distribution

- `P1` **Packaged macOS app** — a build pipeline that bundles the built Next output with Electron, so the app doesn't need the repo or `pnpm desktop`.
- `Done` **Batteries-included app** — Weft.app ships `node`, `npm`, `npx`, `pnpm`, `pnpx`, `puku-cli` (no telemetry) and `claude` on its own Electron, at the end of PATH, so a fresh Mac builds Next.js + Supabase projects with nothing else installed (`scripts/bundle-toolchain.mjs`, docs/architecture/updates.md). Next: maybe git and gh (the Puku trial is under Agents, models and CLIs).
- `P1` **Signing and notarization** — sign and notarize the macOS build so it opens without Gatekeeper warnings. Wired up in `.github/workflows/release.yml` (Developer ID, hardened runtime, notarytool via an App Store Connect key); waiting on the certificate from Alex's individual Apple Developer membership.
- `Done` **Auto-update** — a packaged Weft checks the latest GitHub release's `update.json` at launch and every 4 hours; a signed build downloads in the background and offers Restart to Update, an unsigned one offers the download (`electron/updater.cjs`, docs/architecture/updates.md). Weft → Check for Updates… opens a Software Update window with the versions, last check and release notes (`electron/update-window.cjs`). Next: publish the first signed release; show the release notes after the restart.
- `Done` **Home page at weft.zip** — the deployed Weft (Vercel) renders a landing page at `/` instead of the board (`components/home/`, `lib/home.ts`; `/home` locally): the emblem, the headline "Engineering the future, one thread at a time" (under an "Agentic engineering, on your Mac" eyebrow) and one sentence over the twin suns scene, a real screenshot of the board (`public/brand/board.png`), five pillars (code review, copilot, social, connectors, vault: `PILLARS` in `lib/home.ts`, drawn by `components/home/Pillars.tsx`) and a download button that reads the latest release's `update.json` (`lib/home-release.ts`) and `app/opengraph-image.tsx` for shared links. Under the pillars, six FAQ questions as open/close rows link to `weft.zip/faq`, which renders `docs/FAQ.md` (`app/faq/page.tsx`, `lib/faq.ts`). Pricing landed under the pillars: Free, Pro and Team (components/home/Plans.tsx, priced off lib/billing/plans.ts), and teams became a paid capability (lib/billing/plan-gate.ts). Next: the weft.zip domain on the Vercel project; refresh the screenshot after big board changes; the demo loop and a three-step how-it-works.
- `Done` **Changelog and tagged releases** — `CHANGELOG.md` (Keep a Changelog); a `vX.Y.Z` tag builds and publishes the release with that version's section as its notes.
- `P2` **Single-instance lock** — stop a second copy of the app (or `pnpm dev`) from using the same data folder at once.
- `P2` **Window state** — remember window size and position, the open card, and the browser pane's width and visibility across launches.
- `P2` **Windows and Linux builds** — handle paths, the `/usr/bin/which` lookup, and shell environment differences.
- `P3` **Homebrew cask** — `brew install --cask weft`.
- `P3` **Opt-in crash reports** — send crash logs only if the user turns it on.

## Testing and quality

- `P1` **Unit tests for the core** — *started: `pnpm test` (Vitest) covers BOARD STATUS parsing, review tours, the API guard, automations, format helpers, and every API route (`app/api/routes.test.ts`).* Still to do: store reload rules (running cards become Review on restart), and cost accounting across resumed sessions.
- `Done` **Runner tests** — `lib/runner.test.ts` drives the SDK loop against a fake `query()`: results, permissions and questions, stop, the turn queue, warm spares, login, and the CLI going away. No stub CLI executable yet.
- `Done` **Coverage per project** — the header's "49% coverage" follows the project in view, hovers a breakdown, and without a report is a **Set up coverage** button that starts a `/weft:setup-done` thread there.
- `Done` **A quality score that never maxes out** — the header's code quality badge earns 90 from the checklist (coverage, file size, lint lockdown, types, guardrails) and the last 10 from a **refactor scout**: a read-only Sonnet run that ranks concrete findings (file:line, Fowler smell, category, one-line fix, plus lint rules not yet on and loose types), cached per project with its commit, started once for a project with no report, then refreshed by `/weft:done` or **Re-scout now** (never just because HEAD moved). Each finding starts its own card from the badge's menu. Next: let the copilot hand out findings, and show which ones a card fixed.
- `Done` **Commit the uncommitted pile** — the header's "+N/-N" beside the quality badge (moved up from the status strip) counts the project's uncommitted lines; clicking it starts a card that maps `git status` onto the Review cards' `touchedFiles` (shared, busy and unclaimed files flagged) and commits card by card, by path, with a live checklist page (`lib/commit-pile.ts`, `app/api/pile`). Each change on the page has a review bar whose buttons answer the thread through `weft://reply` links, so you act on the page instead of typing in the thread. Its Commit buttons are `weft://commit` links that commit, push and move the card to Done with no LLM turn (`lib/pile-commit.ts`); the thread steps in only when a step fails. Next: let the copilot suggest it when Review piles up, and mark a card's files as committed so the overlap warning forgets them.
- `Done` **Plan the Backlog into sprints**: the header's ☰ N beside the uncommitted counter counts the repo's Backlog cards. Clicking it starts a read-only card that sizes each one, flags duplicates, cards already done, vague cards and oversized cards, and groups the rest into sprints of cards that touch different files, so each sprint runs side by side in one folder. A sprint plan page drives it through `weft://reply` buttons, and it starts a sprint's cards over `PATCH /api/cards/<id>` only on your OK (`lib/sprint-plan.ts`, `app/api/sprint`). Next: a one-click Start this sprint with no LLM turn, like the pile's `weft://commit`, and feed the plan's order into the run queue.
- `Done` **Saved sprints in the Backlog header**: the flag saves the lane's cards as a named sprint, Archive all (with an "Are you sure?") clears the lane, and the sprints list under the Backlog title restores a sprint's archived cards, renames and deletes it; Backlog cards archive with one click, and ⌘B in New thread adds to the Backlog (`lib/sprints.ts`, `lib/sprint-store.ts`, `components/SprintsMenu.tsx`). Next: Start a saved sprint, and let the planner above save its sprints here.
- `P1` **UI tests** — *started: behavior tests (jsdom + Testing Library, `components/*.test.tsx`) for the card (busy-folder "+N here", Allow/Deny, Stop), the reply box (send, queue while running, Send now, send later, busy-folder warning) and the new-thread dialog (Start vs backlog, folder, busy-folder hint).* Still to do: the board, the thread view, and the real TipTap composer (stubbed in these tests).
- `P2` **CI** — lint, typecheck, and tests on every push.
- `P2` **End-to-end tests** — drive the Electron app: create a card, start it, allow a request, reply, drag it to Done.
- `P2` **Status-line checks** — measure how often each model and CLI ends replies with a valid BOARD STATUS line, and catch regressions when the prompt changes.
- `P2` **Failure drills** — kill a CLI mid-turn, drop the event stream, and corrupt `board.json` on purpose to confirm the app recovers.
- `P3` **Large-board test** — 500 cards and threads with 10,000 items stay responsive.

## Accessibility and polish

- `P1` **Keyboard-first board** — arrow keys between cards, Enter to open, A and D to allow or deny, N for a new card.
- `Done` **Move without dragging** — the card's right-click menu and the command palette move cards between columns.
- `P2` **Screen reader announcements** — a live region that reads out card moves and new permission requests.
- `P2` **Focus return** — focus goes back to the card after closing its thread panel or a dialog.
- `Done` **Resizable thread panel** — the open card is four columns (thread, editor, pane, show), each closable and resizable, remembered (`lib/workspace-layout.ts`, `components/CardWorkspace.tsx`). Next: drag a column to reorder.
- `P2` **Clear error messages** — plain explanations with a fix for common failures: CLI not on PATH, folder missing, logged out, port in use.
- `P2` **Contrast and motion** — check the column colors against contrast guidelines and respect reduced-motion settings.
- `P3` **Text size** — a setting for card and thread text size.
- `P3` **Localization** — keep UI strings in one place so the app can be translated.

## Proposed after the first test runs (2026-10-09)

Ideas that came out of building and testing the projects bar, board status, warm CLIs, login, and questions.

- `P1` **Needs-you inbox** — one keyboard-driven queue of every waiting question and permission request across cards (a to allow, d to deny, 1–4 to pick an answer), so clearing ten blocked cards takes seconds.
- `P1` **Answer from the notification** — Allow, Deny, and the options of a question as buttons on the macOS notification itself, so a blocked card can move without switching to the app.
- `P1` **Lean thread profile** — choose which MCP servers, plugins, and hooks load in board threads (per project), since they are most of a CLI's 4–50s start time and memory.
- `Now` **Stage automations** — rules that run a skill when a thread starts, you move a card to Review or Done, or a prompt you send matches a regex (once per thread per skill; Done runs `/weft:done` by default, which commits and, with **Push on Done** on (the default), pushes). Still to come: per-project rules, a "needs you for over 10 minutes" trigger, and non-skill actions like opening the diff or pinging Slack.
- `P1` **Dev server watcher** — notice when a thread starts a server or prints a localhost URL and offer to open it in the browser pane, tied to that card.
- `P2` **Board status health** — flag threads that stop writing the BOARD STATUS line (instructions ignored or overridden) and nudge them once, so cards don't sit in Review by default.
- `P2` **Copilot policies** — plain-English standing rules the copilot applies to permission requests ("allow read-only commands in deckcp, ask me about anything that pushes"), with a log of what it allowed.
- `P2` **Checkpoints and rewind** — snapshot a card's files and session before risky steps and roll both back with one click.
- `P2` **Menu bar presence** — a menu bar icon with the needs-you count and running cards, and a global shortcut that opens the copilot from any app.
- `P2` **Card from anywhere** — a share-sheet / Raycast / Alfred action that turns selected text or a URL into a Backlog card in the current project.
- `P2` **Standup to Slack** — the copilot posts a morning summary (finished, blocked, spent) to a Slack channel or DM.
- `P3` **Prompt library from history** — find prompts you've sent more than once across threads and offer them as templates.
