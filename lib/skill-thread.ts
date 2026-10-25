import type { RemoteSkill } from "./types";

// The thread a skills.sh hit in the ✦ list opens (components/SkillSearchResults.tsx): it shows the skill's page
// in the pane, has Weft scan and review it, and installs it with mcp__board__skill_install once you say so
// (lib/skill-tools.ts).

export const skillPageUrl = (id: string) => `https://www.skills.sh/${id}`;

export const skillThreadTitle = (hit: Pick<RemoteSkill, "name">) => `✦ Skill: /${hit.name}`;

export function skillThreadPrompt(hit: Pick<RemoteSkill, "id" | "name" | "source">): string {
  return `Look over the skill /${hit.name} from skills.sh (${hit.source}, id ${hit.id}) with me, and install it if I say so.

1. Open its page, ${skillPageUrl(hit.id)}, in the browser pane.
2. Call mcp__board__skill_preview with id "${hit.id}" for Weft's scan of its files: malicious code, prompt injection, telemetry, license.
3. Call mcp__board__skill_review with the same id to start the AI review, and open the review page it gives in the pane. It takes about 20 seconds; call skill_review again to read the verdict.
4. Tell me in a few short lines what the skill does, what it would run or send off my machine, its license, and the verdicts. Name any real concern plainly.
5. Ask me whether to install it, with AskUserQuestion. Only if I say yes, call mcp__board__skill_install with id "${hit.id}". If the scan says danger or the review says unsafe, pass force: true only when I chose to install it anyway.

Install it only through skill_install, which writes the exact copy Weft scanned: never copy its files yourself or run \`npx skills add\`.`;
}
