// One upsert from a flush (lib/cloud-sync-upload.ts), with the errors it can end in. Supabase sits behind
// Cloudflare, whose WAF answers some request bodies with an HTML "Attention Required!" page instead of
// passing them on: thread items are full of shell commands, SQL, HTML and <script> tags. From 2026-10-18 one
// such row held the whole outbox back for days. A blocked request is sent once more with every character in
// its strings but letters and digits written as a JSON \uXXXX escape: Postgres stores exactly the same value,
// so nothing that reads the rows changes, and the WAF no longer sees the text it matched.
import type { SupabaseClient } from "@supabase/supabase-js";

// A Supabase error with its Postgres code, so a refused row can be told from a dropped connection.
export class UploadError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

// The WAF refused the request even in its escaped form. Retrying sends the same bytes, so it is a row error.
export class WafError extends UploadError {
  constructor(message: string) {
    super(message, "waf");
  }
}

// Data exceptions (class 22: a NUL in text, a bad Unicode escape, a value out of range) and WAF blocks fail
// the same way on every retry. Everything else (no network, a 5xx, row-level security) is worth backing off for.
export function isRowError(err: unknown): err is UploadError {
  return err instanceof WafError || (err instanceof UploadError && err.code.startsWith("22"));
}

type Result = { error: { message: string; code?: string } | null; status?: number };

const isHtml = (message: string) => /^\s*</.test(message);

// Supabase hands errors back as plain objects; throw them as Errors so the backoff's warning can read them.
// An HTML page (a proxy's 502, say) is named by its <title> rather than dumped whole into the log.
export function check(result: Result) {
  if (!result.error) return;
  const { message, code } = result.error;
  const title = isHtml(message) ? /<title>([^<]*)<\/title>/i.exec(message)?.[1]?.trim() : undefined;
  throw new UploadError(isHtml(message) ? `The server answered with an HTML page${title ? `: ${title}` : ""}` : message, code ?? "");
}

// postgrest-js puts a non-JSON error body in `message` as is: Cloudflare's block page is HTML.
export function isWafBlock(result: Result): boolean {
  const message = result.error?.message ?? "";
  return isHtml(message) && /attention required|you have been blocked/i.test(message);
}

// A one-line name for the block page, with its Ray ID when it has one, instead of the whole page in the log.
export function wafMessage(message: string, table: string): string {
  const ray = /Ray ID:\s*(?:<[^>]*>\s*)*([0-9a-f]{8,})/i.exec(message)?.[1];
  return `Cloudflare's firewall blocked an upload to ${table}${ray ? ` (Ray ID ${ray})` : ""}`;
}

// JSON with every string's characters but [A-Za-z0-9] as \uXXXX, keys included. Same value once parsed.
export function wafSafeJson(value: unknown): string {
  if (typeof value === "string") return `"${value.replace(/[^A-Za-z0-9]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : wafSafeJson(v))).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = Object.entries(value).filter(([, v]) => v !== undefined);
    return `{${fields.map(([k, v]) => `${wafSafeJson(k)}:${wafSafeJson(v)}`).join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// Upserts `rows` into `table`. A WAF block is retried once escaped; a second block throws a WafError.
export async function upsert(client: SupabaseClient, table: string, rows: object[]): Promise<void> {
  const first: Result = await client.from(table).upsert(rows);
  if (!isWafBlock(first)) {
    check(first);
    return;
  }
  // postgrest-js keeps the fetch it sends with on the builder; swap in our own body, same url and headers.
  const builder = client.from(table).upsert(rows);
  const open = builder as unknown as { fetch: Fetch };
  const inner = open.fetch;
  open.fetch = (url, init) => inner(url, { ...init, body: wafSafeJson(rows) });
  const second: Result = await builder;
  if (isWafBlock(second)) throw new WafError(wafMessage(second.error?.message ?? "", table));
  check(second);
}
