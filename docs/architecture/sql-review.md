# Readable database prompts

The Supabase MCP confirms destructive SQL with an elicitation: "This SQL includes destructive operations (DROP, DELETE,
TRUNCATE or UPDATE without WHERE)… Run it on project X?" and Accept / Decline. The SQL itself isn't in it; it's in the
`execute_sql` / `apply_migration` call that triggered it, often pages long, and often harmless (a `DROP POLICY` right
before its `CREATE POLICY`). Weft puts that SQL on the prompt and has a second model say what it really does.

## How it flows

1. **Track the running calls.** `lib/runner-turn.ts` calls `trackDbCall` for each `tool_use` the stream sees and
   `endDbCall` for each `tool_result`. `lib/db-calls.ts` keeps the database ones on `session.dbCalls` (id → server,
   tool, SQL, migration name). Which tools count is the `DB_TOOLS` table: Supabase's `execute_sql` / `apply_migration`
   (local MCP or the claude.ai connector), and Postgres MCPs' `execute_sql` / `query`. A new database MCP is one row.
2. **Attach to the prompt.** `askUser` (`lib/runner-ask.ts`) calls `attachSql`. For an elicitation, `promptSql` takes
   the newest running call on the same server (names compared the way tool prefixes spell them: `claude.ai Supabase`
   is `claude_ai_supabase`), else the newest running call. For a plain permission prompt on a database tool (no
   elicitation, the card's mode asked), it takes the call's own SQL, but only when the static scan flags something: a
   `SELECT` needs no review. The SQL rides on `Pending.sql` / `PendingPermission.sql` (`PendingSql` in
   `@weft/client`), so weft.zip and the phone show it through the same `card.pending`.
3. **Static scan, no model** (`lib/sql-scan.ts`). Splits statements on top-level semicolons (not inside strings,
   quoted identifiers, comments or dollar quotes), classifies each as `loss` (DELETE, UPDATE, TRUNCATE, DROP
   TABLE/SCHEMA/…, ALTER … DROP COLUMN / TYPE, a DO block or function body that deletes), `drop` (a policy, function,
   view, index, trigger, constraint) or `access` (GRANT, REVOKE, RLS off, ALTER POLICY), and notes what plainly looks
   wrong: DELETE/UPDATE without WHERE, TRUNCATE, a dropped object with no matching CREATE. Its lines are `flagged`,
   which the prompt highlights.
4. **Model review, in the background** (`lib/sql-review.ts`). `reviewPrompt` in `lib/db-calls.ts` starts it after the
   prompt is already on the card. The prompt asks the model to judge, not reassure, and to answer JSON: a verdict
   (`safe`, `access`, `deletes`, `unknown`), a one-line summary, each destructive statement in plain words, what's
   lost and whether it can be recovered, and concerns. The scan's findings go in with the SQL. A reply that doesn't
   parse is `unknown` with an error. Reviews are cached per SQL text (20), so the permission prompt and the
   elicitation for one call share one; a failed review isn't cached. When the review lands and the prompt is still the
   card's first, the card's `pending` is updated.
5. **Show it** (`components/SqlReview.tsx`, inside `PermissionRequest` in `components/ThreadFooter.tsx`): the verdict
   chip and summary, concerns in red, what's lost, the statements; then the SQL folded in a `<details>` with line
   numbers and flagged lines tinted. While the review runs: "A second model is reading the SQL…". The raw input JSON
   under a plain permission prompt leaves out `query` / `sql`, which the block already shows.
6. **Decline leads.** While flagged SQL hasn't been called Safe (still reviewing, or any other verdict), `riskySql`
   makes **Decline** (elicitation) / **Deny** (permission prompt) the first, primary button and Accept / Allow the plain
   one beside it, with a muted line saying why. When the static scan finds what's lost, the line names it
   (`lib/sql-loss.ts`, `PendingSql.loses`): "Suggested: Decline. It deletes every row in team_members, overwrites
   profiles.github_login and drops table old_cards" (three, then "and N more"). Otherwise by verdict: "It changes who can read or
   write." / "The review can't tell what it does." / "Wait for the review, or read the SQL." (`DeclineWhy`, in
   `components/ElicitationForm.tsx` and `AllowDeny` in `components/PermissionInput.tsx`).

## SQL run from Bash

`dbCall` also reads a Bash command that runs SQL (`lib/db-bash.ts`): `psql -c "…"` / `--command=…`, a heredoc into
psql, `psql -f file.sql` / `--file`, and `prisma db execute --file`, the files read from the card's folder (up to
1 MB). Its permission prompt gets the same block, review, Decline-first buttons and auto-accept. Bash has no
elicitation, so only the prompt the card's mode raises carries it: a card in Bypass, or a call Auto's classifier
allows, runs without one. Commands whose SQL Weft can't see (`supabase db push`, `prisma migrate deploy`,
`supabase db reset`) aren't covered yet. Bash calls are never tracked as running database calls, so a Supabase
elicitation can't pick one up.

## Which model

Measured 2026-11-08 on a 564-line migration (the repo's own first migrations) with three problems planted: a
`DELETE FROM team_members;`, an `UPDATE profiles … WHERE true`, and a `DROP POLICY` never re-created. Both Haiku and
Sonnet named all three and called it `deletes`; Haiku took 22-28s, Sonnet 11s. On the same file with a policy dropped
and re-created, Haiku noticed the new policy lost its `TO authenticated` and said "Can't tell". Sonnet it is
(`REVIEW_MODEL`), through `complete(prompt, model)` in `lib/haiku.ts`. SQL past 80,000 characters is cut and the
prompt says so.

## SQL with nothing flagged

A database prompt whose SQL the static scan flags nothing in (a SELECT, a CREATE) still gets the block, with a Safe verdict
from the scan itself ("Nothing in it deletes, drops or changes access.", model `static`), at once and with no model
call. So both switches below let reads through too.

## Allow safe SQL on this card

On a prompt the review calls Safe, a third button beside Accept / Allow: **Allow safe SQL on this card**
(`safeForCard` in `components/SqlReview.tsx`). It sets `card.safeSql` through `card.update` and accepts this prompt.
`safeSql` widens what the thread may do, so `widens()` makes it need Weft's own window (and a signed widening from
another device: "let it run SQL a review calls Safe without asking", `packages/weft-client/src/widen.ts`); a thread's
curl can't set it. The transport offers it on this Mac and on a Weft Worker (`allowSafeSql`), not on weft.zip yet.
From then on that card's prompts that pass `harmless` are accepted unasked, as with the global switch below.

## Accept harmless SQL (opt-in)

Settings → Security → **Database changes** (`components/SqlAutoAcceptSwitch.tsx`, `GET`/`PUT /api/sql-review`, saved
as `sqlAutoAccept` in settings.json, off by default). The `PUT` is `elevated`: only Weft's own window, never a thread's
curl, can turn it on. With it on, a prompt is accepted without asking only when all of these hold (`harmless`):

- the model's verdict is `safe` and the review didn't fail;
- the static scan finds nothing that loses data and no concern (no DELETE/UPDATE without WHERE, no DROP left
  without its CREATE);
- it isn't a form to fill in.

The thread's permission row then reads "Allowed automatically: the sonnet review said Safe" (`auto` on the item).
"Changes access", "Deletes data" and "Can't tell" always wait for you. The setting is this Mac's only: it isn't one of
the account settings a Weft Worker mirrors.

## Not covered

- Codex and Goose have no elicitation channel (thread-guards.md#mcp-elicitations).
- A call that `canUseTool` allows outright (a trusted tool, an allow rule) and that no elicitation follows never
  prompts, so there is nothing to review.
