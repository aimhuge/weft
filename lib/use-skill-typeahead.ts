"use client";

// The Composer's "/" typeahead: tracks the slash query at the cursor, fetches the folder's skills
// the first time the query opens, and exposes the active row, the suggestions, and the dismiss state.
// The skills come from the thread's transport (lib/thread-transport.ts listSkills), so a worker card's list is its
// worker's, for the card's checkout there; outside a thread the transport is this Mac's.
import { useEffect, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { slashAtCursor, type SlashQuery } from "./composer-slash";
import { rankSkills } from "./skill-rank";
import { useThreadTransport } from "./thread-transport";
import type { SkillInfo } from "./types";

export interface UseSkillTypeahead {
  query: SlashQuery | null;
  suggestions: SkillInfo[];
  active: number;
  setActive: (next: number | ((i: number) => number)) => void;
  dismissedAt: number | null;
  setDismissedAt: (pos: number | null) => void;
  typeaheadOpen: boolean;
}

export function useSkillTypeahead(editor: Editor | null, cwd: string | undefined, cardId?: string): UseSkillTypeahead {
  const { listSkills } = useThreadTransport();
  // The current slash query, watched through TipTap's useEditorState so we don't rerender on every keystroke.
  const query = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? slashAtCursor(e) : null),
  });

  const [skills, setSkills] = useState<SkillInfo[]>([]);
  // The highlighted row belongs to one query; a new query starts back at the top.
  const [highlight, setHighlight] = useState<{ query: string | null; i: number }>({ query: null, i: 0 });
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const wantsSkills = query !== null;
  useEffect(() => {
    if (!wantsSkills || !listSkills) return;
    let ignore = false;
    listSkills(cardId, cwd).then(
      (list) => !ignore && setSkills(list),
      () => {},
    );
    return () => {
      ignore = true;
    };
  }, [wantsSkills, cwd, cardId, listSkills]);

  // Clear dismissal when the slash query goes away.
  if (!query && dismissedAt !== null) setDismissedAt(null);
  const active = highlight.query === (query?.query ?? null) ? highlight.i : 0;
  const setActive = (next: number | ((i: number) => number)) =>
    setHighlight({
      query: query?.query ?? null,
      i: typeof next === "function" ? next(active) : next,
    });
  const suggestions = query && query.from !== dismissedAt ? rankSkills(skills, query.query).slice(0, 30) : [];
  const typeaheadOpen = suggestions.length > 0;

  return { query, suggestions, active, setActive, dismissedAt, setDismissedAt, typeaheadOpen };
}
