import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { serverPosthogConfig } from "@/lib/analytics-server";

// PostHog logs from the deployed Weft only; a local board never calls home (lib/analytics-gate.ts).
const posthog = serverPosthogConfig();

export const posthogLoggerProvider = posthog
  ? new LoggerProvider({
      resource: resourceFromAttributes({ "service.name": "weft" }),
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${posthog.host.replace(/\/$/, "")}/i/v1/logs`,
            headers: {
              Authorization: `Bearer ${posthog.token}`,
              "Content-Type": "application/json",
            },
          }),
        }),
      ],
    })
  : null;

const posthogLogger = posthogLoggerProvider?.getLogger("weft.posthog");

type PostHogLogAttributes = Record<string, boolean | number | string>;

// This isolated logger intentionally excludes the application's existing console output.
export function emitPostHogLog(message: string, attributes: PostHogLogAttributes) {
  posthogLogger?.emit({ body: message, severityNumber: SeverityNumber.INFO, attributes });
}

export async function flushPostHogLogs() {
  await posthogLoggerProvider?.forceFlush();
}

export function register() {
  // Keep this provider dedicated to the purpose-written PostHog log lines above.
}
