# 035: "Always allow" pinned the script, not the code it ran, and the token `1` opened local writes

**Date:** 2026-10-20 · **Severity:** Medium (a remembered approval survived the code it authorised, and any process that could reach the local API could answer prompts with a one-character header)

Two findings, one theme: **an approval was remembered too loosely, and the thing it authorised was not the thing
it checked.**

## Symptom

### P-3 — "Always allow" pinned the script, not the code it ran

When a thread asked to run a command with vault secrets and the user chose "Always allow", Weft remembered a rule
covering that command. The rule stored the command line and a hash of the `package.json` script it ran. Editing
the code the script executed kept the approval: the rule said "this command line may run", and the code behind it
could change freely. A thread approved to run `npm run job` could edit `job.js` into something else and run it
again with the user's secrets, without the user being asked. Found in the 2026-10-20 pentest as P-3.

### P-4 — the constant `x-weft-token: 1` opened local writes

Every write to the local API accepted the literal string `1` as the launch token. Any code that could reach the
local server — including a thread — could answer permission prompts, change settings, allow folders and run shell
commands. The `1` is not a credential; it is a constant anyone can type. Found in the 2026-10-20 pentest as P-4.

## Cause

### P-3

`ruleOf` in `electron/run-rules.cjs` hashed the script and returned
`{ id, environment, cwd, command, script: hash(script), kind }`; `sameRule` compared those fields and nothing else.
Nothing described the tree.

The script is the **invocation**, not the **code**. `npm run job` and the `job` script stay byte-identical while
`job.js` — or any file it imports — changes underneath.

### P-4

`guard()` in `lib/guard.ts` accepted either the constant or the real launch token on every write: `sent !== "1" &&
!(sent && hasToken(req, true))` was the only condition on a write. The constant exists because a thread's `curl`
needs to move a card around the board. But the same constant opened the routes that grant power, and nothing
distinguished the two.

## Fix

### P-3 — pin the tree

`treeFingerprint(cwd)` in `electron/run-rules.cjs` hashes the state of the code a command runs: HEAD, the diff
against it, and the bytes of every untracked file.

```js
// after
function treeFingerprint(cwd) {
  try {
    const git = (args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000, maxBuffer: 64 * 1024 * 1024 });
    const sum = crypto.createHash("sha256").update(git(["rev-parse", "HEAD"])).update(git(["diff", "HEAD", "--binary"]));
    const untracked = git(["ls-files", "-o", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
    if (untracked.length > MAX_UNTRACKED) return null;
    const root = git(["rev-parse", "--show-toplevel"]).toString().trim();
    for (const name of untracked.sort()) {
      sum.update(`\0${name}\0`);
      try { sum.update(fs.readFileSync(path.join(root, name))); } catch {}
    }
    return sum.digest("hex");
  } catch { return null; }
}
```

A `run` rule now carries that fingerprint: `wanted()` adds `tree: treeOf(request.cwd)` to a `run` rule, `sameRule`
compares it, and `allows()` returns false on a `null` fingerprint — not a git repo, git failed, too much untracked
to hash — so the rule never holds and an always-allow is never remembered. `remember` takes the same path: a `null`
tree is not remembered at all, and a new approval on a changed tree replaces the spent one rather than sitting
beside it.

`dev` rules deliberately do **not** pin the tree: a dev grant has to survive the dev server restarting while you
edit, so it keeps the old behaviour.

### P-4 — require the real token for power writes

`elevated()` in `lib/guard.ts` adds the missing distinction. Ordinary board moves still take the constant, so
nothing slows down; a write that grants power takes the real launch token from `~/.weft/shell-token`.

```ts
// after
export function elevated(req: Request): Response | null {
  const denied = guard(req);
  if (denied) return denied;
  if (!hasToken(req)) return Response.json({ error: "This change needs Weft's own window" }, { status: 403 });
  return null;
}
```

`hasToken` compares the header against `shellToken()` with `crypto.timingSafeEqual`, so the check is the real
credential rather than a guessable string.

The routes that grant power now call `elevated(req)` instead of `guard(req)`: a permission answer
(`app/api/cards/[id]/permission/route.ts`), settings (`app/api/settings/route.ts`), folder grants
(`app/api/folders/route.ts`), the `!` shell command (`app/api/cards/[id]/shell/route.ts`) and the restart
(`app/api/restart/route.ts`). A card's own mode or read scope asks for it too
(`app/api/cards/[id]/route.ts`). `app/api/cards/route.ts` asks for it only when the new card asks for less than the
default, so a thread may still create cards with the constant.

**Key rule:** an approval should pin the thing it actually depends on — the code a script runs, not the line that
invokes it — and a credential that gates dangerous operations must be the real one, not a constant that anyone can
type.

### P-2 — cloud sync uploaded thread text unredacted

A sibling finding from the same wave: cloud sync uploaded thread text and tool outputs with no secret redaction, so
every workspace member could read them. A key that had reached a thread — pasted, printed by a tool, echoed in an
error — landed in a row the whole workspace could query.

**Fix.** Every free-text string now goes through the share redactor before the upload. `lib/cloud-sync-redact.ts`'s
`redactValue` walks a value — a string is redacted, an array recurses, an object's entries recurse except the
identifiers and paths the rows key on (`id`, `sessionId`, `cwd`, `thumb`, `tool_id`, `toolId`, `pendingId`) — and
replaces key-shaped values with `‹hidden: secret›`. `redactCardRow`, `redactItemRow` and `redactOutputRow` apply
it to a card's JSON, a thread item's JSON and a tool output's text.

`lib/cloud-sync-upload.ts` applies it on the way out — `cardRows(...).map(redactCardRow)`, and the same for the
items and tool outputs — so the raw text stays on the Mac and only the redacted copy leaves.

**Key rule:** text that leaves the machine for a shared store goes through the same redactor the share link uses —
the audience changes, so what may be read does.

**Files:** `electron/run-rules.cjs` (`treeFingerprint`, `ruleOf`, `sameRule`), `electron/run-rules.test.ts`,
`lib/guard.ts` (`elevated`), `lib/guard.test.ts`, `app/api/cards/[id]/permission/route.ts`,
`app/api/settings/route.ts`, `app/api/folders/route.ts`, `app/api/cards/[id]/shell/route.ts`,
`app/api/restart/route.ts`, `app/api/cards/route.ts`, `lib/cloud-sync-redact.ts` (new),
`lib/cloud-sync-redact.test.ts` (new), `lib/cloud-sync-upload.ts`, `docs/architecture/thread-guards.md`,
`docs/architecture/cloud-sync.md`.
