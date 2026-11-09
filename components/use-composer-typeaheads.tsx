"use client";

// The Composer's two typeaheads behind one set of keys (lib/use-composer-keys.ts): "/" for the folder's skills
// (lib/use-skill-typeahead.ts) and "@" for people (lib/use-mention-typeahead.ts). Only one can be open: the cursor sits
// after a "/" token or an "@" one. Returns the open one's state, what picking a row inserts, and its floating list.
import type { Editor } from "@tiptap/react";
import type { MentionPerson } from "@weft/client";
import type { ReactNode } from "react";
import { useMentionTypeahead } from "@/lib/use-mention-typeahead";
import { useSkillTypeahead } from "@/lib/use-skill-typeahead";
import type { TypeaheadState } from "@/lib/use-composer-keys";
import type { SkillInfo } from "@/lib/types";
import PeopleTypeahead from "./PeopleTypeahead";
import SkillTypeahead from "./SkillTypeahead";

type Item = SkillInfo | MentionPerson;

export function useComposerTypeaheads(
  editor: Editor | null,
  cwd: string | undefined,
  cardId: string | undefined,
  variant: "dialog" | "reply",
): { typeahead: TypeaheadState<Item>; pick: (item: Item) => void; list: ReactNode } {
  const skills = useSkillTypeahead(editor, cwd, cardId);
  const people = useMentionTypeahead(editor, cardId);
  const mention = people.typeaheadOpen && people.query !== null;
  const open = (mention ? people : skills) as TypeaheadState<Item>;

  function pick(item: Item) {
    const at = open.query;
    if (!editor || !at) return;
    const text = "login" in item ? `@${item.login} ` : `/${item.name} `;
    editor.chain().focus().insertContentAt({ from: at.from, to: at.to }, text).run();
  }

  const above = variant === "reply";
  let list: ReactNode = null;
  if (mention) {
    list = (
      <PeopleTypeahead
        people={people.suggestions}
        active={Math.min(people.active, people.suggestions.length - 1)}
        className={above ? "inset-x-0 bottom-full mb-1.5" : "inset-x-2 bottom-11"}
        onPick={pick}
        onHover={people.setActive}
      />
    );
  } else if (skills.typeaheadOpen && skills.query) {
    list = (
      <SkillTypeahead skills={skills.suggestions} active={Math.min(skills.active, skills.suggestions.length - 1)} above={above} onPick={pick} onHover={skills.setActive} />
    );
  }
  return { typeahead: open, pick, list };
}
