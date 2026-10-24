import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { bashWrites } from "./bash-writes";
import { ask, forget, realFile, remember } from "./claim-guard";
import { addClaims, claimKey, clashQuestion, clashWhy, dropClaims, findClash, splitClaim } from "./claims";
import { dirtyFiles, repoRoot, writtenSince } from "./dirty-files";
import { failureNote } from "./failure-owners";
import { busyInFolder } from "./overlap";
import { getCard, listCards, updateCard } from "./store";
import type { Card } from "./types";
import { workDir } from "./work-dir";

// Symbol claims for Bash (lib/claims.ts). lib/claim-guard.ts claims what Edit and Write change, but a Bash
// command writes files too (sed -i, a formatter, codegen, `cat > file`), and nothing claimed those.
// Before a Bash call runs, the files its line names as written (lib/bash-writes.ts) that another busy card
// holds ask first, like an edit would. After it runs, in a git repo:
// - the repo's changed files written during the run become whole-file claims of this card, unless another
//   busy card already claims one (then it's most likely that card's edit, made meanwhile);
// - every card's claims on files that are clean now drop: a thread's own `git commit` or a checkout put
//   them in or took them back, so no one should be asked to wait on them;
// - a failed check (typecheck, tests, lint) is told which failures sit in files other cards are editing
//   (lib/failure-owners.ts).

// When each Bash call started, by tool use id; calls that never finish fall past the cap.
const STARTED_CAP = 200;
const started = new Map<string, number>();

function start(id: string) {
  started.set(id, Date.now());
  if (started.size > STARTED_CAP) started.delete(started.keys().next().value as string);
}

const commandOf = (input: unknown) => {
  const c = (input as { command?: unknown } | null)?.command;
  return typeof c === "string" ? c : "";
};

export function bashClaimGuard(cardId: () => string | undefined): HookCallback {
  return (input, toolUseId) => {
    if (input.hook_event_name !== "PreToolUse" || !toolUseId) return Promise.resolve({});
    const card = getCard(cardId() ?? "");
    if (!card) return Promise.resolve({});
    start(toolUseId);
    const keys = bashWrites(commandOf(input.tool_input), input.cwd).map((f) => claimKey(realFile(f)));
    const clash = keys.length ? findClash(listCards(), card, keys) : undefined;
    if (!clash) return Promise.resolve({});
    const question = clashQuestion(clash);
    remember(toolUseId, [], question, clashWhy(clash));
    return Promise.resolve(ask(question));
  };
}

// This card's claim on each file it wrote, skipping the ones another busy card holds.
export function claimWritten(card: Card, written: string[]) {
  const held = new Set(busyInFolder(listCards(), workDir(card), card.id).flatMap((c) => (c.claims ?? []).map((k) => splitClaim(k).file)));
  const next = addClaims(card.claims, written.filter((f) => !held.has(f)).map((f) => claimKey(f)));
  if (next) updateCard(card.id, { claims: next });
}

// Every card's claims on files in this repo that git no longer sees as changed.
export function releaseClean(root: string, dirty: Set<string>) {
  for (const card of listCards()) {
    const clean = new Set((card.claims ?? []).map((k) => splitClaim(k).file).filter((f) => f.startsWith(root + path.sep) && !dirty.has(f)));
    const kept = clean.size ? dropClaims(card.claims, clean) : undefined;
    if (kept) updateCard(card.id, { claims: kept });
  }
}

// A Bash result's text, from PostToolUse's response or PostToolUseFailure's error.
function outputOf(input: Parameters<HookCallback>[0]): string {
  if (input.hook_event_name === "PostToolUseFailure") return input.error;
  if (input.hook_event_name !== "PostToolUse") return "";
  const r = input.tool_response as { stdout?: unknown; stderr?: unknown } | string | null;
  if (typeof r === "string") return r;
  return [r?.stdout, r?.stderr].filter((s): s is string => typeof s === "string").join("\n");
}

export function bashClaimRecorder(cardId: () => string | undefined): HookCallback {
  return (input, toolUseId) => {
    const event = input.hook_event_name;
    if (event !== "PostToolUse" && event !== "PostToolUseFailure") return Promise.resolve({});
    const since = toolUseId ? started.get(toolUseId) : undefined;
    if (toolUseId) {
      started.delete(toolUseId);
      forget(toolUseId);
    }
    const card = getCard(cardId() ?? "");
    const root = card && repoRoot(input.cwd);
    const dirty = root ? dirtyFiles(root) : undefined;
    if (!card || !root || !dirty) return Promise.resolve({});
    if (since !== undefined) claimWritten(card, writtenSince(dirty, since));
    releaseClean(root, new Set(dirty));
    const note = failureNote(commandOf(input.tool_input), outputOf(input), input.cwd, root, card, listCards());
    return Promise.resolve(note ? { hookSpecificOutput: { hookEventName: event, additionalContext: note } } : {});
  };
}

// For lib/env.ts guardedCli: the session's card id, read at each call, since a warm spare gets its card later.
export function bashClaimHooks(cardId: () => string | undefined): { pre: HookCallbackMatcher; post: HookCallbackMatcher } {
  return { pre: { matcher: "Bash", hooks: [bashClaimGuard(cardId)] }, post: { matcher: "Bash", hooks: [bashClaimRecorder(cardId)] } };
}
