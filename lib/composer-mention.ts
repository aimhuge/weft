// "@" detection for the Composer's people picker (docs/architecture/sharing.md#mentions): when the cursor sits at the
// end of an "@login" token, returns it; otherwise null. Pure, like lib/composer-slash.ts, so tests pin the rules.
import type { Editor } from "@tiptap/react";
import type { SlashQuery } from "./composer-slash";

// "@login" at the start of a word, right before the cursor: an @ inside a word is an email address.
const AT = /(^|\s|\()@((?:[A-Za-z0-9][A-Za-z0-9-]{0,38})?)$/;

export function mentionIn(textBefore: string): string | null {
  return AT.exec(textBefore)?.[2] ?? null;
}

// The mention query at the editor's cursor, or null. Not in a code block or a "!" shell command.
export function mentionAtCursor(e: Editor): SlashQuery | null {
  const { selection } = e.state;
  if (!selection.empty || e.isActive("codeBlock") || /^\s*!/.test(e.state.doc.textContent)) return null;
  const { $from } = selection;
  const query = mentionIn($from.parent.textBetween(0, $from.parentOffset, undefined, "￼"));
  if (query === null) return null;
  return { query, from: $from.pos - query.length - 1, to: $from.pos };
}
