import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { captureAiGeneration } from "./ai-observability";

// One plain Haiku completion through a CLI with nothing loaded: no settings, hooks, MCP, tools or session file.
// Haiku with a bare CLI measured ~8-15s, steadier than puku-ai-2.8 (docs/ROADMAP.md). `model` picks a stronger one
// where Haiku is too weak (the SQL review, lib/sql-review.ts).
export async function complete(prompt: string, model = "haiku") {
  let text = "";
  const traceId = randomUUID();
  const startedAt = Date.now();
  for await (const msg of query({
    prompt,
    options: { model, tools: [], settingSources: [], strictMcpConfig: true, persistSession: false, maxTurns: 1 },
  })) {
    if (msg.type !== "result") continue;
    const usage = "usage" in msg ? msg.usage : undefined;
    await captureAiGeneration({
      sessionId: null,
      traceId,
      spanName: "haiku_completion",
      model,
      input: prompt,
      output: msg.subtype === "success" ? msg.result : undefined,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      cacheReadInputTokens: usage?.cache_read_input_tokens,
      cacheCreationInputTokens: usage?.cache_creation_input_tokens,
      latencyMs: Date.now() - startedAt,
      isError: msg.subtype !== "success",
      error: msg.subtype !== "success" ? msg.subtype : undefined,
      stream: true,
    });
    if (msg.subtype === "success") text = msg.result;
  }
  return text;
}
