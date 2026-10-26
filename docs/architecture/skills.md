# Skills: one library, a set per card

A thread gets only the skills its work needs. Weft keeps one library of every skill it can find, each
project keeps a default set, and each card can change its own. Every runner gets the card's set in the
form it reads, when its CLI starts.

## The library (`lib/skill-library.ts`)

- **Weft's**: `plugin/skills`, loaded as the `weft` plugin, run as `/weft:<name>` (`lib/skills.ts`).
- **The project's**: `<folder>/.claude/skills`.
- **Yours**: `~/.claude/skills`.
- **Plugins**: what Claude Code installed (`~/.claude/plugins/installed_plugins.json`), less the ones your
  `enabledPlugins` already turns off. A plugin is one row, with its skill count, because it can only be
  switched as a whole (below).

Skills stay where they are; Weft never copies them.

## A project's default set (`lib/skill-sets.ts`)

`~/.weft/skill-sets.json` holds an **off-list** per folder: skill names (`tdac`) and plugin ids
(`posthog@posthog`). An off-list rather than an on-list, so a skill Weft doesn't know of (Claude Code's
bundled ones, a skill added later) stays on.

It's seeded once per folder (`ensureSeeded`, called as a spare opens there and when a drawer reads it)
from what that folder's threads ran (`lib/skill-usage.ts`): Weft's and the project's skills stay on;
a skill of yours, or a plugin, that no transcript ran goes off. The scan reads every transcript in
`~/.claude/projects/<folder>` and `~/.puku-cli/projects/<folder>` (Weft's own folder has over a GB),
in the background, caching each file's skills by size in `~/.weft/skill-usage.json`. A run counts as
a `<command-name>`, a Skill tool call, a typed `/name`, or the "Base directory for this skill" line a
skill Claude loaded itself leaves behind. Until the seed lands, threads there get everything.

## A card's set

`Card.skillsOn` / `Card.skillsOff` are the card's changes from its project's set; `offFor(card)` is
the project's off-list plus the card's off, less the card's on. `toggleCardSkill` stores the smallest
change, so a row put back to the project's value leaves no override.

## Runner adapters

`specFor` (`lib/runner-state.ts`) puts `offFor(card)` on `Spec.skillsOff`; the copilot keeps every skill.

| Runner | How it gets the set |
| --- | --- |
| Claude Code | `--settings` (`queryOptions` → `withSkillSettings`): `skillOverrides: {name: "user-invocable-only"}` for skills, `enabledPlugins: {id: false}` for plugins |
| puku | the same settings, plus `skillIndex(cwd, { off })` in its first message (`lib/puku-context.ts`), since it doesn't read `.claude/skills` |
| Codex | `skillIndex(cwd, { off })` in its first prompt (`lib/codex-runner-prompt.ts`) |

Checked against the CLI on 2026-10-19:

- `skillOverrides` takes bare names; a plugin-qualified key (`posthog:signals`) is ignored, so plugins
  go through `enabledPlugins`, keyed `name@marketplace`.
- `"user-invocable-only"` hides the skill from the model but `/name` still runs it, so an automation's
  `/skill` and one you type keep working. `skillInvocation` isn't filtered for the same reason.
- `applyFlagSettings` with these keys on a running session didn't change its listing, so a set is fixed
  when the CLI starts. Spares open with their folder's project set (`ensureSpare`); `adoptSpare` skips
  the spare when the card's off-list differs (`sameOff`), and that card starts its own CLI. A change to an
  idle card's set closes its CLI (`setCardSkill` → `endSession`); the next message resumes the session
  with the new set. A busy one picks it up the next time it starts.

## API and UI

- `GET /api/skills/set?cwd=` or `?card=` → `skillSetView` (`lib/skill-set-actions.ts`): a row per skill
  and plugin with `inProject`, `on` and `changedHere`. `PUT` `{ cwd | card, name, on }`.
- ✦ on the rail (`components/SkillsDrawer.tsx`): the board's project's default set.
- ✦N in a card header (`components/SkillsChip.tsx`): the card's set, N the skills its model sees
  (a plugin counts as its skills). Both draw `components/SkillSetList.tsx` from `lib/use-skill-set.ts`,
  laid out by `lib/skill-set-view.ts`.

## Finding skills on skills.sh

Typing in either ✦ list's filter also searches skills.sh, the open skill registry, below your own matches
("From skills.sh"), so a skill you don't have yet is still found. `lib/skill-registry.ts` calls its two
public endpoints (no key, checked 2026-10-26):

- `GET https://skills.sh/api/search?q=&limit=` → `{ skills: [{ id: "owner/repo/skill", source, name, installs }] }`
- `GET https://skills.sh/api/download/<owner>/<repo>/<skill>` → `{ files: [{ path, contents }], hash }`

`WEFT_SKILL_REGISTRY` points it elsewhere. Opening a hit downloads it into **Weft's own copy of the registry**
(`lib/skill-cache.ts`), `~/.weft/skill-registry/<owner>/<repo>/<skill>/<hash>/`: `files/`, `meta.json`,
`scan.json` and, once reviewed, `review.json`. Kept by content hash, so a skill is scanned and reviewed once
per version, the drawer still shows it when skills.sh is down (`offline`), and **Install** writes exactly the
copy that was reviewed to `~/.claude/skills/<name>` (`lib/skill-install.ts`), with a `.weft-source.json`
saying where and which hash it came from. Every runner reads that folder. A download is refused with no
SKILL.md, over 300 files or 5 MB, or with a path outside its folder.

## The skill scan

Two passes, the second building on the first:

1. **Static** (`lib/skill-scan.ts`, rules in `lib/skill-scan-rules.ts`, license in `lib/skill-license.ts`). Every
   text file, SKILL.md included (its lines are instructions a model runs with your tools, as able to do harm as a
   script): malicious code (pipe-to-shell, decode-and-run, reverse shells, miners, disk wipes, env exfiltration;
   credentials, persistence, sudo, skipped permissions, encoded blobs as warnings), prompt injection (override
   instructions, hiding things from you, instructions in HTML comments, invisible unicode), telemetry (webhook
   and capture endpoints as danger, analytics SDKs and beacons as warnings, every host a script calls), binaries,
   and the license (permissive, copyleft, non-commercial, proprietary, unknown, none). Tests and fixtures skip the
   prompt rules, since they quote attacks to catch them. Verdict: danger, warn or clean.
2. **AI review** (`lib/skill-review-agent.ts`, run by `lib/skill-review.ts`). Sonnet gets the static findings, then
   reads the skill with Read, Grep and Glob, held to its folder by a PreToolUse hook (plus the secret guard). It
   says what the skill really does, which findings are real, which are false alarms (Microsoft's official
   `curl … | bash` installer, say), what the rules missed (over-broad SQL grants, billable deploys) and what to
   do. It answers in JSON, which Weft renders itself (`lib/skill-review-page.ts`) as a page in
   `~/.weft/show/skill-reviews/`. The page has a no-script CSP and every string on it is escaped: the pane gives
   `file:` pages its bridge, and a skill must never reach it. Starting a review writes the page at once with the
   static scan and a refresh; the review rewrites it when it lands (~20 s measured). Kept beside the copy it read.

A danger verdict, or an AI review saying unsafe, turns Install into **Install anyway…**, behind a confirm.

**A hit's name opens a thread on it** (`lib/skill-thread.ts`, started by `startSkillThread` in
`lib/skill-registry-client.ts` on your last CLI and model, in the list's folder, then opened with `openCardById`).
Its prompt has the thread open the skill's own page (`https://www.skills.sh/<owner>/<repo>/<skill>`, its README,
installs and audits) in the pane, call `mcp__board__skill_preview` (Weft's copy and static scan, as text) and
`mcp__board__skill_review` (starts or reads the AI review and gives its page to open), sum it up, ask with
AskUserQuestion, and only on a yes call `mcp__board__skill_install` (`force` only when you chose Install anyway).
The three tools are in every thread's board tools (`lib/skill-tools.ts`); preview and review skip the permission
prompt, install doesn't. The prompt forbids copying files or `npx skills add`, so what lands is the copy Weft
scanned. The ▾ beside a hit keeps the quick scan in the list.

**Your own skills** are scanned too (`lib/skill-scan-library.ts`): each time a ✦ list opens, every skill
folder and plugin in the library, cached in `~/.weft/skill-scans.json` by a signature of its files and the rules
themselves, so only a skill that changed (or a rule that changed) is read again (~0.9 s cold for 49, 15 ms
warm). A row whose scan found more than a license note gets a ⚠; clicking it opens that skill's AI review in
the pane, kept under `~/.weft/skill-registry/local/` by the folder's signature.

Routes: `GET /api/skills/search?q=&cwd=`, `GET /api/skills/remote?id=` (preview) and `POST { id, force }`
(install), `GET`/`POST /api/skills/review` with `{ id, hash? }` or `{ cwd, name }` (a plugin by its id),
`GET /api/skills/scan?cwd=`. The board calls them through `lib/skill-registry-client.ts`; the UI is
`components/SkillSearchResults.tsx` and `components/SkillScanPill.tsx`, its hooks `lib/use-skill-search.ts`.

## Still open

- Share the scanned registry across Weft users (a weft.zip table of hash → scan + review), so a skill is
  reviewed once for everyone, not once per Mac.
- More sources beside skills.sh (Claude Code plugin marketplaces, GitHub repos by URL); update checks from
  `.weft-source.json`; install into a project's `.claude/skills` instead of yours.
- New skill from a card; the copilot's own set; applying a change to a running CLI if a later CLI
  re-reads `skillOverrides` mid-session; confirming puku-cli honours `skillOverrides` the way Claude Code
  does (it accepts the settings).
