import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { bashWrites } from "./bash-writes";
import { closeWindow, markKnown, markUnknown, openWindow, unknownWriters, writersAt } from "./bash-writers";
import { ask, forget, realFile, remember } from "./claim-guard";
import { addClaims, claimKey, clashQuestion, clashWhy, dropClaims, findClash, splitClaim } from "./claims";
import { dirtyFiles, repoRoot, writtenAt } from "./dirty-files";
import { failureNote } from "./failure-owners";
import { busyInFolder } from "./overlap";
import { pruneYields } from "./yields";
import { getCard, listCards, updateCard } from "./store";
import type { Card } from "./types";
import { workDir } from "./work-dir";

// Symbol claims for Bash (lib/claims.ts). lib/claim-guard.ts claims what Edit and Write change, but a Bash
// command writes files too (sed -i, a formatter, codegen, `cat > file`), and nothing claimed those.
// Before a Bash call runs, the files its line names as written (lib/bash-writes.ts) that another busy card
// holds ask first, like an edit would. After it runs, in a git repo:
// - the repo's changed files written during the run become whole-file claims of this card, unless another
//   busy card already claims one (then it's most likely that card's edit, made meanwhile), or another card's
//   Bash was running too when it was written and the line doesn't name it: then its writer is unknown
//   (lib/bash-writers.ts), and no card claims it;
// - every card's claims on files that are clean now drop: a thread's own `git commit` or a checkout put
//   them in or took them back, so no one should be asked to wait on them;
// - a failed check (typecheck, tests, lint) is told which failures sit in files other cards are editing
//   (lib/failure-owners.ts).

const commandOf = (input: unknown) => {
  const c = (input as { command?: unknown } | null)?.command;
  return typeof c === "string" ? c : "";
};

export function bashClaimGuard(cardId: () => string | undefined): HookCallback {
  return (input, toolUseId) => {
    if (input.hook_event_name !== "PreToolUse" || !toolUseId) return Promise.resolve({});
    const card = getCard(cardId() ?? "");
    if (!card) return Promise.resolve({});
    openWindow(toolUseId, card.id);
    const keys = bashWrites(commandOf(input.tool_input), input.cwd).map((f) => claimKey(realFile(f)));
    if (keys.length) pruneYields();
    const clash = keys.length ? findClash(listCards(), card, keys) : undefined;
    if (!clash) return Promise.resolve({});
    const question = clashQuestion(clash);
    remember(toolUseId, [], question, clashWhy(clash));
    return Promise.resolve(ask(question));
  };
}

// Codex and Goose run no Weft hooks, so a busy one in the tree could have written anything, unseen.
const UNHOOKED = new Set(["codex", "goose"]);

// This card's claim on each file it wrote (by mtime), skipping the ones another busy card holds. One written
// while only this card's Bash ran, or that the command line names, is this card's; any other is unknown.
export function claimWritten(card: Card, written: Map<string, number>, named: Set<string>) {
  const busy = busyInFolder(listCards(), workDir(card), card.id);
  const held = new Set(busy.flatMap((c) => (c.claims ?? []).map((k) => splitClaim(k).file)));
  const unseen = busy.some((c) => UNHOOKED.has(c.backend));
  const mine: string[] = [];
  for (const [file, at] of written) {
    if (held.has(file)) continue;
    const writers = writersAt(at);
    if (named.has(file) || (!unseen && writers.size === 1 && writers.has(card.id))) {
      mine.push(file);
      markKnown(file);
    } else markUnknown(file);
  }
  const next = addClaims(card.claims, mine.map((f) => claimKey(f)));
  if (next) updateCard(card.id, { claims: next });
}

// Every card's claims on files in this repo that git no longer sees as changed.
export function releaseClean(root: string, dirty: Set<string>) {
  for (const file of [...unknownWriters()]) if (file.startsWith(root + path.sep) && !dirty.has(file)) markKnown(file);
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
    const background = (input.tool_input as { run_in_background?: unknown } | null)?.run_in_background === true;
    const since = toolUseId ? closeWindow(toolUseId, background) : undefined;
    if (toolUseId) forget(toolUseId);
    const card = getCard(cardId() ?? "");
    const root = card && repoRoot(input.cwd);
    const dirty = root ? dirtyFiles(root) : undefined;
    if (!card || !root || !dirty) return Promise.resolve({});
    const command = commandOf(input.tool_input);
    if (since !== undefined) claimWritten(card, writtenAt(dirty, since), new Set(bashWrites(command, input.cwd).map(realFile)));
    releaseClean(root, new Set(dirty));
    const note = failureNote(command, outputOf(input), input.cwd, root, card, listCards(), unknownWriters());
    return Promise.resolve(note ? { hookSpecificOutput: { hookEventName: event, additionalContext: note } } : {});
  };
}

// For lib/env.ts guardedCli: the session's card id, read at each call, since a warm spare gets its card later.
export function bashClaimHooks(cardId: () => string | undefined): { pre: HookCallbackMatcher; post: HookCallbackMatcher } {
  return { pre: { matcher: "Bash", hooks: [bashClaimGuard(cardId)] }, post: { matcher: "Bash", hooks: [bashClaimRecorder(cardId)] } };
}
