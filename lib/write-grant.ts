import { getCard } from "./store";
import { safeUpdate, type Session } from "./runner-state";
import { changesPermissions, grantedWrite, scopeFor, scopeLabel, writeTarget, type WriteScope } from "./write-scope";

// Ask once per card for a skill's folder or a settings file (lib/write-scope.ts has the rule). When auto mode's
// classifier blocks a write there and you allow it, the card keeps that folder or file in card.writeScope for the
// rest of its life, and the PreToolUse hook (lib/classifier-denial.ts withRetryGrant) lets later writes there
// through without asking again. Per card and per folder: another card, or another path, still asks.

// The scope a blocked call would grant, or undefined when allowing it should stay a one-time allow: not a write,
// not in a skill folder or a settings file, or a write that changes permissions.
export function grantScope(session: Session, toolName: string, input: Record<string, unknown>): WriteScope | undefined {
  const cwd = session.spec.cwd;
  const file = cwd ? writeTarget(toolName, input, cwd) : undefined;
  if (!file) return undefined;
  const scope = scopeFor(file, cwd);
  return scope && !changesPermissions(toolName, input, file) ? scope : undefined;
}

// You allowed it: the card keeps the scope from now on.
export function grantWrites(cardId: string, scope: WriteScope) {
  const have = getCard(cardId)?.writeScope ?? [];
  if (!have.includes(scope.path)) safeUpdate(cardId, { writeScope: [...have, scope.path] });
}

// Whether the card's grants let this call through.
export function writeGranted(session: Session, toolName: string, input: Record<string, unknown>): boolean {
  if (!session.cardId || !session.spec.cwd || !writeTarget(toolName, input, session.spec.cwd)) return false;
  return grantedWrite(getCard(session.cardId)?.writeScope, toolName, input, session.spec.cwd);
}

// What the Allow button says for a scope: "Allow writes to the research skill for this card".
export function grantButton(scope: WriteScope): string {
  return `Allow writes to ${scopeLabel(scope)} for this card`;
}
