import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import { releaseOnWrite } from "./blocking";
import { addClaims, claimKey, dropClaims, splitClaim } from "./claims";
import { claimPreAnswer, claimPreHook, claimPostCard, forget, pendingEntry } from "./claim-hooks";
import { editedPath } from "./overlap";
import { listCards, updateCard } from "./store";
import { isMarkdownFile, markdownSymbolsFor } from "./symbols-markdown";

// Symbol claims in every board thread (lib/claims.ts). Before an Edit, MultiEdit, Write or NotebookEdit, the
// PreToolUse hook works out what it claims from the file as it is, and when another busy card in the same
// tree holds a clashing claim it answers "ask", so the user decides: wait, or go ahead. Once the edit has
// run, the PostToolUse hook puts its claims on the card; a denied edit claims nothing. Board data and the
// edited file only, no git.

// Past this many symbols in one edit it's a restructure: claim the whole file.
export const MAX_SYMBOLS = 5;

interface EditInput {
  old_string?: unknown;
  new_string?: unknown;
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
// NotebookEdit, a file with no parser (Markdown goes by blocks, lib/symbols-markdown.ts), an old_string that isn't there, or an edit spanning more
// than MAX_SYMBOLS symbols. [] for an edit to imports alone, and for tools that don't edit files.
export async function claimsFor(toolName: string, input: Record<string, unknown>, cwd: string): Promise<string[]> {
  const given = editedPath(toolName, input);
  if (!given) return [];
  const file = realFile(path.resolve(cwd, given));
  const whole = [claimKey(file)];
  const edits = editsOf(toolName, input);
  if (!edits.length) return whole;
  const markdown = isMarkdownFile(file);
  const parser = markdown ? null : await import("./symbols");
  if (parser && !parser.isSourceFile(file)) return whole;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return whole;
  }
  const names = new Set<string>();
  // MultiEdit's later edits may match only after earlier ones: those miss and claim the whole file.
  for (const e of edits) {
    const found = typeof e.old_string !== "string" ? null
      : parser ? parser.symbolsFor(file, text, e.old_string, e.replace_all === true)
      : markdownSymbolsFor(text, e.old_string, typeof e.new_string === "string" ? e.new_string : "", e.replace_all === true);
    if (!found) return whole;
    for (const n of found) names.add(n);
  }
  if (names.size > MAX_SYMBOLS) return whole;
  return [...names].map((n) => claimKey(file, n));
}

// The pending tool calls and what they asked about live with the claim flow (lib/claim-hooks.ts), which
// the Bash guard shares; re-exported here, where the edit guards have always been reached for them.
export { ask, claimQuestion, claimSymbols, claimWhy, forget, remember } from "./claim-hooks";

export function claimGuard(cardId: () => string | undefined): HookCallback {
  return async (input, toolUseId) => {
    if (input.hook_event_name !== "PreToolUse" || !toolUseId) return {};
    const out = await claimPreHook(cardId() ?? "", () => claimsFor(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, input.cwd));
    return claimPreAnswer(out, toolUseId);
  };
}

export function claimRecorder(cardId: () => string | undefined): HookCallback {
  return (input, toolUseId) => {
    const entry = pendingEntry(toolUseId);
    if (input.hook_event_name !== "PostToolUse" || !entry) return Promise.resolve({});
    forget(toolUseId as string);
    const card = claimPostCard(cardId() ?? "");
    const next = card && addClaims(card.claims, entry.keys);
    if (card && next) updateCard(card.id, { claims: next });
    // The write landed: the cards waiting on this one for this file can redo their edit on top of it
    // now (lib/blocking.ts), instead of staying blocked until this card commits or its turn ends.
    if (card) for (const key of entry.keys) releaseOnWrite(card.id, splitClaim(key).file);
    return Promise.resolve({});
  };
}

const EDITS = "Edit|MultiEdit|Write|NotebookEdit";

// For lib/env.ts guardedCli: the session's card id, read at each call, since a warm spare gets its card later.
export function claimHooks(cardId: () => string | undefined): { pre: HookCallbackMatcher; post: HookCallbackMatcher } {
  return { pre: { matcher: EDITS, hooks: [claimGuard(cardId)] }, post: { matcher: EDITS, hooks: [claimRecorder(cardId)] } };
}

// After a commit of these files (absolute paths), every card's claims on them drop: their changes are in.
// On a file the commit held lines back from (lib/commit-held.ts), only the committing card's do.
export function releaseClaims(files: string[], partial: string[] = [], committer?: string) {
  const whole = new Set(files.filter((f) => !partial.includes(f)));
  const all = new Set(files);
  for (const card of listCards()) {
    const kept = dropClaims(card.claims, card.id === committer ? all : whole);
    if (kept) updateCard(card.id, { claims: kept });
  }
}
