import { apiFetch, API_HEADERS } from "./api-client";
import { resetIntros } from "./feature-intros";
import type { GithubProfile } from "./github-profile";
import { resetSyncPrompt } from "./sync-prompt";
import type { Welcome } from "./welcome";
import type { WelcomeProfile, WelcomeProject } from "./welcome-preview";

// The board's side of /api/welcome (lib/welcome.ts): load it, answer it, change it in Settings.

export interface WelcomePreview {
  projects: WelcomeProject[];
  profile: WelcomeProfile;
  github: GithubProfile | null;
}

export interface WelcomeView {
  welcome: Welcome | null;
  preview?: WelcomePreview;
}

export interface WelcomeAnswer {
  countHistory: boolean;
  fresh: boolean;
  skip: string[];
}

const WRITE = { ...API_HEADERS, "content-type": "application/json" };

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
  return body;
}

export const loadWelcome = (replay = false) => apiFetch(`/api/welcome${replay ? "?replay=1" : ""}`).then((r) => json<WelcomeView>(r));

// Settings → General's "Replay the welcome" asks the dialog to show itself again, as a preview.
export const REPLAY_EVENT = "weft:welcome-replay";
// Bring back every first-time welcome past the dialog: each drawer's intro video and the ask to sync.
export function resetOnboarding() {
  resetIntros();
  resetSyncPrompt();
}

// Replay the welcome (avatar menu, command palette): the dialog again as a preview, and the welcomes after it too.
export function replayWelcome() {
  resetOnboarding();
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

// Its "Test it" asks the dialog to load the real welcome again, once the server has been told to show it.
export const TEST_EVENT = "weft:welcome-test";

export const answerWelcome = (answer: WelcomeAnswer) =>
  fetch("/api/welcome", { method: "POST", headers: WRITE, body: JSON.stringify(answer) }).then((r) => json<{ welcome: Welcome }>(r));

export const changeWelcome = (patch: { countHistory: boolean } | { importAll: true } | { test: true }) =>
  fetch("/api/welcome", { method: "PATCH", headers: WRITE, body: JSON.stringify(patch) }).then((r) => json<{ welcome: Welcome | null }>(r));

// Screen 2's ticks to the answer: OK skips the unticked folders, Start fresh brings in none of the old ones.
export function answerFor(countHistory: boolean, projects: WelcomeProject[], ticked: ReadonlySet<string>, fresh: boolean): WelcomeAnswer {
  return { countHistory, fresh, skip: fresh ? [] : projects.filter((p) => !ticked.has(p.cwd)).map((p) => p.cwd) };
}

// The folders ticked to start with: every real project, no scratch ones.
export const defaultTicks = (projects: WelcomeProject[]) => new Set(projects.filter((p) => !p.scratch).map((p) => p.cwd));
