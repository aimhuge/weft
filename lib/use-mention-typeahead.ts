"use client";

// The Composer's "@" picker (docs/architecture/sharing.md#mentions): tracks the @query at the cursor and asks the thread's
// transport for people (lib/thread-transport.ts searchPeople) after a short pause, so a typed login doesn't fire a
// GitHub search per key. Shaped like lib/use-skill-typeahead.ts, so the composer's keys drive either.
import { useEffect, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import type { MentionPerson } from "@weft/client";
import { mentionAtCursor } from "./composer-mention";
import { localSearchPeople, preloadPeople } from "./people-search";
import { useThreadTransport } from "./thread-transport";
import type { TypeaheadState } from "./use-composer-keys";

export const MENTION_DEBOUNCE_MS = 200;

export function useMentionTypeahead(editor: Editor | null, cardId?: string): TypeaheadState<MentionPerson> {
  const { searchPeople } = useThreadTransport();
  const query = useEditorState({ editor, selector: ({ editor: e }) => (e ? mentionAtCursor(e) : null) });
  const text = query?.query ?? null;
  const [found, setFound] = useState<{ for: string | null; people: MentionPerson[] }>({ for: null, people: [] });
  const [highlight, setHighlight] = useState<{ query: string | null; i: number }>({ query: null, i: 0 });
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // The desktop composer's open: fetch the workspace and repo people now, not on the first "@".
  useEffect(() => {
    if (editor && searchPeople === localSearchPeople) preloadPeople(cardId);
  }, [editor, cardId, searchPeople]);

  useEffect(() => {
    if (text === null || !searchPeople) return;
    let ignore = false;
    const show = (people: MentionPerson[]) => !ignore && setFound({ for: text, people });
    // Local people show on the next frame; only GitHub's search waits out the typing pause.
    const run = () => void searchPeople(cardId, text, show).then(show, () => {});
    const timer = setTimeout(run, text ? MENTION_DEBOUNCE_MS : 0);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [text, cardId, searchPeople]);

  if (!query && dismissedAt !== null) setDismissedAt(null);
  const active = highlight.query === text ? highlight.i : 0;
  const setActive = (next: number | ((i: number) => number)) => setHighlight({ query: text, i: typeof next === "function" ? next(active) : next });
  // The last answer stays up while the next one is on its way, so the list doesn't blink per key.
  const suggestions = query && query.from !== dismissedAt ? found.people : [];
  return { query, suggestions, active, setActive, dismissedAt, setDismissedAt, typeaheadOpen: suggestions.length > 0 };
}
