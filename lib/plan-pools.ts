import type { Backend } from "./types";

// Which CLIs read one plan's counter.
//
// Each CLI has its OWN plan, and each plan has its own limits:
//   - Claude Code runs on Anthropic's subscription: its 5-hour and weekly windows are the claude.ai
//     account's (sdk.d.ts:4293 — the SDK's rate_limits come from the claude.ai usage endpoint).
//   - puku-cli runs on PUKU's plan: it bills through Puku's gateway (lib/puku-proxy.ts points at
//     https://api-cli.puku.sh) and Puku's allowance is its own. It has no Anthropic plan limit.
//   - Codex runs OpenAI's plan; Goose whatever provider it is on.
//
// So the counters are per CLI. GROUPS is empty: no two CLIs share a counter, and every CLI reads its
// own. The grouping stays because it is the one place that answers "whose counter is this?", and a
// CLI added later reads its own numbers until someone says otherwise.
//
// The mistake this replaces (commit bcabb72, "the plan limits are one pool per account") filed
// puku under Claude's counter, on the strength of two limits.jsonl rows tagged "backend":"puku" at
// 2026-10-23 19:45. Those rows were not puku's own: a card switched with "Run on puku" kept its
// Claude stats, and lib/runner-turn.ts logged a late Claude reading under the card's NEW backend
// (docs/bug-fixes/031-puku-cards-showed-claudes-limits.md). One pool then meant a puku thread
// inherited Claude's spent 5-hour window: the New thread dialog blocked it with "Start at 2:30am"
// and changing the model changed nothing.
//
// The per-CLI reading was already shipped once (commit f338d62) and reverted; the revert's own
// premise was the misread.
const GROUPS: Backend[][] = [];

// The pool a CLI reads from: the other CLIs on the same plan, plus itself.
export function poolOf(backend: Backend): Backend[] {
  return GROUPS.find((group) => group.includes(backend)) ?? [backend];
}

// Whether two CLIs read the same plan's counter.
export function samePool(a: Backend, b: Backend): boolean {
  return poolOf(a).includes(b);
}

// The pool's name, as a key: the first CLI in the group. One plan, one key.
export function poolKey(backend: Backend): string {
  return poolOf(backend)[0] ?? backend;
}
