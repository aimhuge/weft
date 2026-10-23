import posthog from "posthog-js";
import { isLocalHost, posthogConfig } from "./analytics-gate";

// Browser analytics for weft.zip: PostHog (started here from instrumentation-client.ts) and GA4 (the gtag snippet
// components/GoogleAnalytics.tsx puts on every deployed page). On a local board neither exists, so track() and
// identify calls fall through without a word (lib/analytics-gate.ts says why).

type Props = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function startAnalytics(hostname: string = location.hostname, doc: Document = document): boolean {
  if (isLocalHost(hostname)) return false;
  doc.addEventListener("click", trackClick, { capture: true });
  const config = posthogConfig();
  if (!config) return false;
  posthog.init(config.token, { api_host: config.host, defaults: "2026-05-30", capture_exceptions: true });
  return true;
}

// True once PostHog has started; identify, reset and captureException check it first.
export function analyticsOn(): boolean {
  return posthog.__loaded;
}

// One event to both tools, named the same in each.
export function track(event: string, props: Props = {}): void {
  if (analyticsOn()) posthog.capture(event, props);
  window.gtag?.("event", event, props);
}

// Server components can't attach handlers, so a link opts in with data-track="event" and data-track-<prop>="value"
// (the home page's download button: data-track="download_clicked" data-track-version="0.4.0").
export function trackClick(event: Event): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-track]") : null;
  const name = target?.dataset.track;
  if (!target || !name) return;
  const props: Props = {};
  for (const [key, value] of Object.entries(target.dataset)) {
    if (key === "track" || !key.startsWith("track")) continue;
    const prop = key.slice("track".length);
    props[prop.charAt(0).toLowerCase() + prop.slice(1)] = value;
  }
  if (target instanceof HTMLAnchorElement) props.href = target.href;
  track(name, props);
}
