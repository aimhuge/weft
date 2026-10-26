import { api, call } from "./client-api";
import { BACKEND_IDS, LAST_BACKEND, modelFor, remembered } from "./new-thread";
import { skillThreadPrompt, skillThreadTitle } from "./skill-thread";
import type { Backend, RemoteSkill, RemoteSkillPreview, SkillReviewState, SkillScan } from "./types";

// The board's calls to the skill registry routes (app/api/skills/{search,remote,review,scan}).

const qs = (params: Record<string, string | undefined>) =>
  Object.entries(params)
    .filter((e): e is [string, string] => Boolean(e[1]))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

export type ReviewWhere = { id: string; hash?: string } | { cwd?: string; name: string };

export const skillRegistry = {
  search: (q: string, cwd?: string, signal?: AbortSignal) => call<{ skills: RemoteSkill[] }>("GET", `/api/skills/search?${qs({ q, cwd })}`, undefined, signal),
  preview: (id: string, cwd?: string) => call<RemoteSkillPreview>("GET", `/api/skills/remote?${qs({ id, cwd })}`),
  install: (id: string, force = false) => call<{ name: string; scan: SkillScan }>("POST", "/api/skills/remote", { id, force }),
  review: (where: ReviewWhere) => call<SkillReviewState>("POST", "/api/skills/review", where),
  reviewState: (where: ReviewWhere) => call<SkillReviewState>("GET", `/api/skills/review?${qs(where)}`),
  scans: (cwd?: string) => call<{ scans: Record<string, SkillScan> }>("GET", `/api/skills/scan?${qs({ cwd })}`),
};

// Starts the thread a skills.sh hit opens (lib/skill-thread.ts) on your last-used CLI and model; resolves with its id.
export async function startSkillThread(hit: RemoteSkill, cwd: string): Promise<string> {
  const last = remembered(LAST_BACKEND) as Backend | null;
  const backend: Backend = last && BACKEND_IDS.includes(last) ? last : "claude";
  const model = modelFor(backend) || undefined;
  const { card } = await api.create({ title: skillThreadTitle(hit), prompt: skillThreadPrompt(hit), cwd, backend, model, start: true });
  return card.id;
}
