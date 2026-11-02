import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import { bashClaimHooks } from "../bash-claims";
import { changelogStampHooks } from "../changelog-stamp";
import { claimHooks } from "../claim-guard";
import { clipboardGuardMatcher } from "../clipboard-guard";
import { folderGuardMatcher } from "../folder-guard";
import { CHECK_GUARD_MATCHER } from "../check-guard";
import { commitHeldHook } from "../commit-held-guard";
import { GIT_GUARD_MATCHER } from "../git-guard";
import { IMPORT_GUARD_MATCHER } from "../import-check";
import { restartGuardMatcher } from "../restart-guard";
import { ROUTE_IMPORT_GUARD_MATCHER } from "../route-import-guard";
import { secretGuardMatcher } from "../secret-guard";
import { WORKER_CLI_GUARD_MATCHER } from "../worker-cli-guard";

// Weft's guard set: one list of hooks per event, the same for every CLI (docs/architecture/thread-guards.md).
// Claude Code and puku-cli take it as the Agent SDK's in-process hooks (lib/env.ts guardedCli); Codex and Goose
// reach it through their own hooks and Weft's guard route, which runs it with decide() (lib/guards/decide.ts).
//
// The hook that turns away reads of .env files and environment dumps in every permission mode, the one that won't
// restart Weft while other cards' turns run (otherTurns counts them), the one that won't read the clipboard while a
// pairing code is open (lib/clipboard-guard.ts), the one that won't stash, reset --hard or clean
// away other cards' uncommitted work, the one that sends tsc and eslint through the pnpm scripts that take turns, the
// one that refuses an edit making a route file import a module that isn't there yet, the one that reports an edit
// breaking an import, symbol claims, which ask before an edit to what another busy card is editing (Bash writes too,
// which also drop claims on files gone clean and tell a failed check whose failures are another card's), the folder
// gate, which asks before a tool reaches outside the card's project, and the changelog stamp, which marks the card's
// changelog entries committed when its own commit lands, and the one that keeps other cards' lines of a shared doc
// out of this card's commit.sh (cardId names the session's card, once it has one), and the one that won't run the
// Weft Worker's own command line (lib/worker-cli-guard.ts), which decides which Mac a worker trusts with secrets.
export type GuardHooks = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

export function guardHooks(otherTurns: () => number, cardId: () => string | undefined): GuardHooks {
  const claims = claimHooks(cardId);
  const bash = bashClaimHooks(cardId);
  const stamp = changelogStampHooks(cardId);
  return {
    PreToolUse: [secretGuardMatcher(cardId), restartGuardMatcher(otherTurns), GIT_GUARD_MATCHER, CHECK_GUARD_MATCHER, ROUTE_IMPORT_GUARD_MATCHER, folderGuardMatcher(cardId), claims.pre, bash.pre, stamp.pre, commitHeldHook(cardId), clipboardGuardMatcher(), WORKER_CLI_GUARD_MATCHER],
    PostToolUse: [IMPORT_GUARD_MATCHER, claims.post, bash.post, stamp.post],
    PostToolUseFailure: [bash.post],
  };
}
