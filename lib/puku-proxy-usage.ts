// What a Puku request costs (lib/puku-proxy.ts, docs/architecture/puku-trial.md): the tokens set aside before it
// goes upstream, and the tokens it really used, read from the reply as it passes through. The proxy is reachable
// from any HTTP client holding a trial token, so neither half trusts the client: the reservation is taken before a
// byte goes out, and the usage is reported however the reply ends, including a client hanging up just before the
// last event.

// What one user used of the trial on one UTC day. Tokens count input (including cache writes) and output;
// cache reads are kept but don't count toward the cap, since they cost a fraction of the rest.
export interface Usage {
  requests: number;
  input_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
}

export const NO_USAGE: Usage = { requests: 0, input_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };

// The tokens set aside for one request before it goes out: its input estimated from the text it carries, its
// output at the max_tokens it asks for.
export interface Reserve {
  input: number;
  output: number;
}

export const NO_RESERVE: Reserve = { input: 0, output: 0 };

// The most output one request may ask for, and what's set aside when it doesn't say (the Messages API requires
// max_tokens, so Puku refuses that request and the reservation comes back).
export const MAX_OUTPUT_TOKENS = 128_000;
export const DEFAULT_OUTPUT_TOKENS = 32_000;
// Roughly four characters a token for text. An image or a document's base64 counts as a flat 1,600 tokens: by
// its length it would read as hundreds of thousands.
const CHARS_PER_TOKEN = 4;
const ATTACHMENT_TOKENS = 1_600;

const tokensOf = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

// The text a request carries, walked with a stack rather than recursion so a deeply nested body can't overflow it.
function textChars(root: unknown): number {
  let chars = 0;
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === "string") chars += value.length;
    else if (value && typeof value === "object") {
      const fields = value as Record<string, unknown>;
      if (fields.type === "base64") chars += ATTACHMENT_TOKENS * CHARS_PER_TOKEN;
      else for (const field of Object.values(fields)) stack.push(field);
    }
  }
  return chars;
}

// What to set aside for a messages request, or why it's refused. A body that isn't JSON is set aside by its size.
export function reserve(body: ArrayBuffer | undefined): Reserve | { refused: string } {
  const text = body ? new TextDecoder().decode(body) : "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { input: tokensOf(text.length), output: DEFAULT_OUTPUT_TOKENS };
  }
  const asked = (parsed as { max_tokens?: unknown } | null)?.max_tokens;
  const output = typeof asked === "number" && Number.isFinite(asked) && asked > 0 ? Math.ceil(asked) : DEFAULT_OUTPUT_TOKENS;
  if (output > MAX_OUTPUT_TOKENS) return { refused: `Weft's Puku allows max_tokens up to ${MAX_OUTPUT_TOKENS}.` };
  return { input: tokensOf(textChars(parsed)), output };
}

interface RawUsage {
  input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  output_tokens?: unknown;
}

export const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

// Folds one usage object from the reply into the running total. message_start carries the input counts, each
// message_delta the output so far (a running total, not an increment), so the larger of each wins.
export function mergeUsage(total: Usage, raw: RawUsage | undefined): Usage {
  if (!raw || typeof raw !== "object") return total;
  return {
    requests: total.requests,
    input_tokens: Math.max(total.input_tokens, count(raw.input_tokens) + count(raw.cache_creation_input_tokens)),
    cache_read_tokens: Math.max(total.cache_read_tokens, count(raw.cache_read_input_tokens)),
    output_tokens: Math.max(total.output_tokens, count(raw.output_tokens)),
  };
}

interface Event {
  usage?: RawUsage;
  message?: { usage?: RawUsage };
  delta?: { text?: unknown; thinking?: unknown; partial_json?: unknown };
}

function parse(text: string): Event | undefined {
  try {
    const event: unknown = JSON.parse(text);
    return event && typeof event === "object" ? event : undefined;
  } catch {
    return undefined;
  }
}

const fold = (total: Usage, event: Event) => mergeUsage(mergeUsage(total, event.message?.usage), event.usage);

// The usage in one SSE data line, or in a whole JSON reply.
export function usageIn(text: string, total: Usage): Usage {
  const event = parse(text);
  return event ? fold(total, event) : total;
}

// The text a streamed delta writes: what a reply cut short has produced so far.
function written(event: Event): number {
  const { text, thinking, partial_json } = event.delta ?? {};
  return [text, thinking, partial_json].reduce<number>((n, part) => n + (typeof part === "string" ? part.length : 0), 0);
}

// Reads usage out of a reply as it passes: every SSE data line of a streamed one, or the whole body of a JSON one.
function usageReader(streaming: boolean) {
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = NO_USAGE;
  let chars = 0;
  const lines = (final: boolean) => {
    const parts = buffer.split("\n");
    buffer = final ? "" : (parts.pop() ?? "");
    for (const line of parts) {
      const event = line.startsWith("data:") ? parse(line.slice(5).trim()) : undefined;
      if (!event) continue;
      usage = fold(usage, event);
      chars += written(event);
    }
  };
  return {
    push(chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      if (streaming) lines(false);
    },
    // A reply cut short never got its last message_delta, so its output is at least the text already written.
    total(clean: boolean): Usage {
      buffer += decoder.decode();
      if (streaming) lines(true);
      else usage = usageIn(buffer, usage);
      return clean ? usage : { ...usage, output_tokens: Math.max(usage.output_tokens, tokensOf(chars)) };
    },
  };
}

// An upstream that fails to cancel has nothing left to tell the meter.
const ignore = () => {};

export interface MeterHooks {
  // The incoming request's signal: it aborts when the client hangs up.
  signal?: AbortSignal;
  // Keeps the server alive until the usage is written (Next's after(), on Vercel waitUntil). Called once, while
  // the request is still being handled, with a promise that settles when it is.
  background?: (task: Promise<void>) => void;
  // Reports the reply cut short once this long has passed. A client that reads the text and then sits on an open
  // socket would otherwise never let the reply end before the platform kills the function, and never pay.
  deadlineMs?: number;
}

// Passes the reply through unchanged, reading usage from it on the way, and reports it exactly once however the
// reply ends: read to the end (clean), or cancelled by the client, aborted with the request or broken upstream.
export function metered(
  body: ReadableStream<Uint8Array>,
  streaming: boolean,
  done: (usage: Usage, clean: boolean) => Promise<void>,
  hooks: MeterHooks = {},
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const usage = usageReader(streaming);
  let report: Promise<void> | undefined;
  let finish!: () => void;
  hooks.background?.(new Promise<void>((resolve) => (finish = resolve)));
  function end(clean: boolean): Promise<void> {
    if (report) return report;
    hooks.signal?.removeEventListener("abort", hangUp);
    clearTimeout(deadline);
    report = done(usage.total(clean), clean)
      .catch((err: unknown) => console.error(`Puku trial: couldn't record usage: ${(err as Error).message}`))
      .finally(finish);
    return report;
  }
  function hangUp() {
    void end(false);
    reader.cancel().catch(ignore);
  }
  const deadline = hooks.deadlineMs ? setTimeout(hangUp, hooks.deadlineMs) : undefined;
  if (hooks.signal?.aborted) hangUp();
  else hooks.signal?.addEventListener("abort", hangUp, { once: true });
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          await end(true);
          controller.close();
          return;
        }
        usage.push(next.value);
        controller.enqueue(next.value);
      } catch (err) {
        void end(false);
        controller.error(err);
      }
    },
    async cancel(reason) {
      const report = end(false);
      reader.cancel(reason).catch(ignore);
      await report;
    },
  });
}
