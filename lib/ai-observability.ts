import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";
import { serverPosthogConfig } from "./analytics-server";

type AiCapture = {
  event: "$ai_generation" | "$ai_span";
  sessionId: string | null;
  traceId: string;
  spanName: string;
  input?: unknown;
  output?: unknown;
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  latencyMs?: number;
  isError?: boolean;
  error?: string;
  stream?: boolean;
};

// The deployed Weft only: Haiku and scout runs on a Mac carry the builder's own prompts and replies, which stay
// on it (lib/analytics-gate.ts).
function client() {
  const config = serverPosthogConfig();
  if (!config) return;
  return new PostHog(config.token, {
    host: config.host,
    flushAt: 1,
    flushInterval: 0,
    privacyMode: false,
    enableExceptionAutocapture: true,
  });
}

function inputProperties(event: AiCapture["event"], input: unknown) {
  if (input === undefined) return {};
  return event === "$ai_generation" ? { $ai_input: [{ role: "user", content: input }] } : { $ai_input_state: input };
}

function outputProperties(event: AiCapture["event"], output: unknown) {
  if (output === undefined) return {};
  return event === "$ai_generation" ? { $ai_output_choices: [{ role: "assistant", content: output }] } : { $ai_output_state: output };
}

async function capture({ event, sessionId, traceId, spanName, input, output, model, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, latencyMs, isError, error, stream }: AiCapture) {
  const posthog = client();
  if (!posthog) return;
  try {
    posthog.capture({
      distinctId: `ai:${sessionId ?? traceId}`,
      event,
      properties: {
        $ai_trace_id: traceId,
        $ai_session_id: sessionId,
        $ai_span_name: spanName,
        ...(event === "$ai_span" ? { $ai_span_id: randomUUID(), $ai_parent_id: traceId } : {}),
        ...(model ? { $ai_model: model, $ai_provider: "anthropic" } : {}),
        ...inputProperties(event, input),
        ...outputProperties(event, output),
        ...(inputTokens != null ? { $ai_input_tokens: inputTokens } : {}),
        ...(outputTokens != null ? { $ai_output_tokens: outputTokens } : {}),
        ...(cacheReadInputTokens != null ? { $ai_cache_read_input_tokens: cacheReadInputTokens } : {}),
        ...(cacheCreationInputTokens != null ? { $ai_cache_creation_input_tokens: cacheCreationInputTokens } : {}),
        ...(latencyMs !== undefined ? { $ai_latency: latencyMs / 1_000 } : {}),
        ...(isError ? { $ai_is_error: true, ...(error ? { $ai_error: error } : {}) } : {}),
        ...(stream ? { $ai_stream: true } : {}),
      },
    });
  } finally {
    await posthog.shutdown().catch(() => {});
  }
}

export function captureAiGeneration(eventData: Omit<AiCapture, "event">) {
  return capture({ ...eventData, event: "$ai_generation" });
}

export function captureAiToolSpan(eventData: Omit<AiCapture, "event" | "model" | "inputTokens" | "outputTokens" | "cacheReadInputTokens" | "cacheCreationInputTokens" | "stream">) {
  return capture({ ...eventData, event: "$ai_span" });
}
