// The skills the "/" typeahead offers on a card: Weft's own, the host's ~/.claude/skills and the card's folder's, as
// that host finds them (lib/skills.ts). On a worker this is the worker's list for its checkout, not this Mac's.
import { listSkills } from "../skills";
import type { SkillInfo } from "../types";
import { requireCard, settle } from "./types";

export function skillsListVerb({ id }: { id: string }): Promise<{ skills: SkillInfo[] }> {
  return settle(() => ({ skills: listSkills(requireCard(id).cwd) }));
}
