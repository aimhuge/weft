import type { Backend } from "./types";

// Which CLIs read one plan's counter.
//
// Claude Code and puku-cli both run the Anthropic Agent SDK (lib/runner-session.ts queryOptions) against
// a claude.ai account session, and the SDK's rate_limits come from the claude.ai usage endpoint
// (sdk.d.ts:4293) — null for API-key, Bedrock and Vertex sessions (sdk.d.ts:4286). So they read the SAME
// 5-hour and weekly windows: one pool per account. Puku changes the billing (Puku's gateway,
// lib/puku-proxy.ts), not the counter.
//
// The log agrees: the puku sample of 2026-10-23 19:45 carried Claude Code's reset epoch to the second and
// the next value in one climbing sequence. Two accounts cannot share an epoch like that.
//
// Codex runs OpenAI's plan and Goose whatever provider it is on; each keeps its own windows. A CLI in no
// group is its own pool, so a CLI added later reads its own numbers until someone says otherwise.
const GROUPS: Backend[][] = [["claude", "puku"], ["codex"], ["goose"]];

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
