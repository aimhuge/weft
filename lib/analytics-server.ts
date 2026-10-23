import { posthogConfig, type PosthogConfig } from "./analytics-gate";
import { isDeployed } from "./home";

// For posthog-node and the OTLP log exporter: only the deployed Weft, and only with both values set.
export function serverPosthogConfig(env: Record<string, string | undefined> = process.env): PosthogConfig | null {
  if (!isDeployed(env)) return null;
  return posthogConfig(env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, env.NEXT_PUBLIC_POSTHOG_HOST);
}
