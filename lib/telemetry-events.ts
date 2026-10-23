// The anonymous onboarding stats' allow-list (lib/telemetry.ts), on its own so the board can import it: each event
// and the only props it may carry. Plain values only; never a prompt, a project name, a path or an email.

export const ONBOARDING_EVENTS = {
  onboarding_started: ["has_history", "cli_ready", "replay"],
  onboarding_tour_beat: ["beat", "seconds", "jumped"],
  onboarding_tour_nav: ["action", "from", "to"],
  onboarding_narration_muted: ["muted", "beat"],
  onboarding_signin_clicked: [],
  onboarding_cli_login: ["backend"],
  onboarding_step: ["step", "seconds_on_last"],
  onboarding_projects_answered: ["brought", "count_history", "start_empty"],
  onboarding_first_thread: ["backend", "used_starter", "replay"],
  onboarding_skipped: ["step", "replay"],
} as const satisfies Record<string, readonly string[]>;

export type OnboardingEvent = keyof typeof ONBOARDING_EVENTS;
export type EventProps = Record<string, string | number | boolean>;

export function isOnboardingEvent(name: unknown): name is OnboardingEvent {
  return typeof name === "string" && Object.hasOwn(ONBOARDING_EVENTS, name);
}

// Only the event's own keys, only plain values, strings cut to 40 characters.
export function cleanProps(event: OnboardingEvent, props: unknown): EventProps {
  const allowed: readonly string[] = ONBOARDING_EVENTS[event];
  const out: EventProps = {};
  if (typeof props !== "object" || props === null) return out;
  for (const [key, value] of Object.entries(props)) {
    if (!allowed.includes(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, 40);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export const isAnonymousId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
