"use client";

// The key handlers on the Composer's outer div: arrow keys / Enter / Tab / Escape navigate the
// "/" skill typeahead when it's open, the dictation binding toggles the mic on the modifier-aware
// key, and Escape cancels a recording in progress.
import { type SyntheticEvent, useCallback } from "react";
import { currentBinding, matches } from "@/lib/shortcuts";
import type { useDictation } from "@/lib/use-dictation";
import type { SlashQuery } from "./composer-slash";
import type { SkillInfo } from "./types";

// The "/" skills or the "@" people (lib/use-mention-typeahead.ts): whichever is open, the same keys drive it.
export interface TypeaheadState<T = SkillInfo> {
  query: SlashQuery | null;
  suggestions: T[];
  active: number;
  setActive: (next: number | ((i: number) => number)) => void;
  dismissedAt: number | null;
  setDismissedAt: (pos: number | null) => void;
  typeaheadOpen: boolean;
}

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]);

// Arrow keys / Enter / Tab / Escape drive the open "/" typeahead; true when the key was taken.
function typeaheadKey<T>(ne: KeyboardEvent, typeahead: TypeaheadState<T>, pickSkill: (item: T) => void): boolean {
  const { query, suggestions, active, setActive, setDismissedAt, typeaheadOpen } = typeahead;
  if (!typeaheadOpen || !query || ne.isComposing || !NAV_KEYS.has(ne.key)) return false;
  const last = suggestions.length - 1;
  ne.preventDefault();
  ne.stopPropagation();
  if (ne.key === "ArrowDown") setActive((i) => (i >= last ? 0 : i + 1));
  else if (ne.key === "ArrowUp") setActive((i) => (i <= 0 ? last : i - 1));
  else if (ne.key === "Escape") setDismissedAt(query.from);
  else {
    const skill = suggestions[Math.min(active, last)];
    if (skill) pickSkill(skill);
  }
  return true;
}

export function useComposerKeys<T = SkillInfo>({
  typeahead,
  dictation,
  pickSkill,
}: {
  typeahead: TypeaheadState<T>;
  dictation: ReturnType<typeof useDictation>;
  pickSkill: (item: T) => void;
}) {
  // The key is claimed at capture so the editor or textarea can't type its macOS character first
  // (Option+' is "æ"). Matching on e.code is what makes that work.
  const onKeyDownCapture = useCallback(
    (e: SyntheticEvent) => {
      const ne = e.nativeEvent;
      if (!(ne instanceof KeyboardEvent)) return;
      if (typeaheadKey(ne, typeahead, pickSkill)) return;
      if (ne.isComposing || !matches(ne, currentBinding("dictation"))) return;
      ne.preventDefault();
      ne.stopPropagation();
      if (!ne.repeat) dictation.toggle();
    },
    [typeahead, dictation, pickSkill],
  );

  const onKeyDown = useCallback(
    (e: SyntheticEvent) => {
      const ne = e.nativeEvent;
      if (!(ne instanceof KeyboardEvent)) return;
      if (ne.key === "Escape" && dictation.state === "recording") {
        ne.stopPropagation();
        dictation.cancel();
      }
    },
    [dictation],
  );

  return { onKeyDownCapture, onKeyDown };
}
