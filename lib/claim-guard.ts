import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import { addClaims, claimKey, clashQuestion, clashWhy, dropClaims, findClash, splitClaim, WHOLE_FILE } from "./claims";
import { editedPath } from "./overlap";
import { pruneYields } from "./yields";
import { getCard, listCards, updateCard } from "./store";
import type { PromptReason } from "./types";

// Symbol claims in every board thread (lib/claims.ts). Before an Edit, MultiEdit, Write or NotebookEdit, the
// PreToolUse hook works out what it claims from the file as it is, and when another busy card in the same
// tree holds a clashing claim it answers "ask", so the user decides: wait, or go ahead. Once the edit has
// run, the PostToolUse hook puts its claims on the card; a denied edit claims nothing. Board data and the
// edited file only, no git.

// Past this many symbols in one edit it's a restructure: claim the whole file.
export const MAX_SYMBOLS = 5;

interface EditInput {
  old_string?: unknown;
  replace_all?: unknown;
}

function editsOf(toolName: string, input: Record<string, unknown>): EditInput[] {
  if (toolName === "Edit") return [input];
  return Array.isArray(input.edits) ? (input.edits as EditInput[]) : [];
}

// The file's real path, the way git names it (/var is /private/var on macOS), so a commit's paths
// (lib/pile-commit.ts, from the repo's root) find its claims. A file the edit creates goes by its folder's.
export function realFile(file: string) {
  try {
    return fs.realpathSync(file);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
    } catch {
      return file;
    }
  }
}

// What a file-editing tool call claims: each top-level symbol it touches, or the whole file for Write,
// NotebookEdit, a file the parser can't read, an old_string that isn't there, or an edit spanning more
// than MAX_SYMBOLS symbols. [] for an edit to imports alone, and for tools that don't edit files.
export async function claimsFor(toolName: string, input: Record<string, unknown>, cwd: string): Promise<string[]> {
  const given = editedPath(toolName, input);
  if (!given) return [];
  const file = realFile(path.resolve(cwd, given));
  const whole = [claimKey(file)];
  const edits = editsOf(toolName, input);
  if (!edits.length) return whole;
  const { isSourceFile, symbolsFor } = await import("./symbols");
  if (!isSourceFile(file)) return whole;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return whole;
  }
  const names = new Set<string>();
  // MultiEdit's later edits may match only after earlier ones: those miss and claim the whole file.
  for (const e of edits) {
    const found = typeof e.old_string === "string" ? symbolsFor(file, text, e.old_string, e.replace_all === true) : null;
    if (!found) return whole;
    for (const n of found) names.add(n);
  }
  if (names.size > MAX_SYMBOLS) return whole;
  return [...names].map((n) => claimKey(file, n));
}

// What each pending edit will claim and, when it clashed, the question it asked, by tool use id, from
// PreToolUse to PostToolUse (or to canUseTool for the question). Denied edits never reach PostToolUse,
// so the oldest go past PENDING_CAP.
const PENDING_CAP = 200;
const pending = new Map<string, { keys: string[]; question?: string; why?: PromptReason }>();

export function remember(id: string, keys: string[], question?: string, why?: PromptReason) {
  pending.set(id, { keys, question, why });
  if (pending.size > PENDING_CAP) pending.delete(pending.keys().next().value as string);
}

// A Bash call that asked keeps nothing for the edit recorder: lib/bash-claims.ts drops it once it has run.
export function forget(id: string) {
  pending.delete(id);
}

// The clash question for a tool call the hook asked about, for the permission prompt's title.
export function claimQuestion(toolUseId: string | undefined) {
  return toolUseId ? pending.get(toolUseId)?.question : undefined;
}

// Why the hook asked: who holds the clashing claim and what going ahead risks, for under the prompt's title.
export function claimWhy(toolUseId: string | undefined) {
  return toolUseId ? pending.get(toolUseId)?.why : undefined;
}

// The symbols a pending tool call edits, for the permission prompt's preview (lib/edit-preview.ts);
// undefined when the hook didn't see it or it claims the whole file.
export function claimSymbols(toolUseId: string | undefined) {
  const keys = toolUseId ? pending.get(toolUseId)?.keys : undefined;
  const symbols = keys?.map((k) => splitClaim(k).symbol);
  return symbols?.length && !symbols.includes(WHOLE_FILE) ? symbols : undefined;
}

export const ask = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "ask" as const, permissionDecisionReason: reason } });

export function claimGuard(cardId: () => string | undefined): HookCallback {
  return async (input, toolUseId) => {
    if (input.hook_event_name !== "PreToolUse" || !toolUseId) return {};
    const card = getCard(cardId() ?? "");
    if (!card) return {};
    const keys = await claimsFor(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, input.cwd);
    if (!keys.length) return {};
    pruneYields();
    const clash = findClash(listCards(), card, keys);
    const question = clash ? clashQuestion(clash) : undefined;
    remember(toolUseId, keys, question, clash && clashWhy(clash));
    return question ? ask(question) : {};
  };
}

export function claimRecorder(cardId: () => string | undefined): HookCallback {
  return (input, toolUseId) => {
    const entry = toolUseId ? pending.get(toolUseId) : undefined;
    if (input.hook_event_name !== "PostToolUse" || !entry) return Promise.resolve({});
    pending.delete(toolUseId as string);
    const card = getCard(cardId() ?? "");
    const next = card && addClaims(card.claims, entry.keys);
    if (card && next) updateCard(card.id, { claims: next });
    return Promise.resolve({});
  };
}

const EDITS = "Edit|MultiEdit|Write|NotebookEdit";

// For lib/env.ts guardedCli: the session's card id, read at each call, since a warm spare gets its card later.
export function claimHooks(cardId: () => string | undefined): { pre: HookCallbackMatcher; post: HookCallbackMatcher } {
  return { pre: { matcher: EDITS, hooks: [claimGuard(cardId)] }, post: { matcher: EDITS, hooks: [claimRecorder(cardId)] } };
}

// After a commit of these files (absolute paths), every card's claims on them drop: their changes are in.
export function releaseClaims(files: string[]) {
  const set = new Set(files);
  for (const card of listCards()) {
    const kept = dropClaims(card.claims, set);
    if (kept) updateCard(card.id, { claims: kept });
  }
}
