// The home page's "What Weft sends home" note (components/home/SendsHome.tsx), under the plans. Every line here is a
// promise the code keeps, so each one names where it's kept (docs/architecture/analytics.md has the whole picture):
// the desktop's anonymous counts are lib/telemetry-events.ts's allow-list, downloads are lib/download-track.ts, the site's
// cookies wait on lib/consent.ts, and Project Sync is the per-project switch in Settings → Sync. Say it plainly; HN reads it.

export interface SendsHomeItem {
  what: string;
  detail: string;
}

export const SENDS_HOME = {
  title: "What Weft sends home",
  items: [
    {
      what: "Your work stays yours.",
      detail:
        "Prompts, replies and code go from your CLI to the model you picked. The app uploads none of it, unless you " +
        "turn on Project Sync for a project.",
    },
    {
      what: "A few anonymous counts from the app.",
      detail:
        "The welcome's steps, your first card, your first Done and one ping a day you use it, under a hashed device id. " +
        "Never a prompt, a path, a project name or an email. Switch it off in Settings → Security.",
    },
    {
      what: "Downloads, counted without cookies.",
      detail: "The download link counts on our server, with no cookie and no IP address passed on.",
    },
    {
      what: "This site asks first.",
      detail: "weft.zip loads Google Analytics and PostHog only after you say yes to cookies.",
    },
    {
      what: "Project Sync is yours to turn on.",
      detail:
        "Signed in, a project you sync uploads its cards to your workspace, so you can read them on the web and your " +
        "phone. It's off for every project until you switch it on.",
    },
  ] satisfies SendsHomeItem[],
  privacy: { label: "Privacy policy", href: "/privacy" },
} as const;
