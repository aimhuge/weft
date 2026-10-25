// The share viewer's redactor (lib/share-types.ts): every key-shaped value in a thread item is replaced
// with `‹hidden: <kind>›` so a leaked share link can't leak your API tokens. The patterns come from
// lib/secret-detect.ts — same shapes the Composer flags, the pre-commit hook scans for, the thread
// env strips — so an API key that wasn't safe to paste into the chat isn't safe to paste through
// a share either. A second pass over what's left flags any long high-entropy opaque token
// (lib/share-redact-entropy.ts) the patterns didn't know about — a custom in-house API key, a
// freshly-minted one-off, an internal SaaS token — and redacts it as "an opaque value".
//
// The redactor walks an item like collectBlobRefs walks a thread (lib/web-board.ts): strings are
// scanned, arrays/objects recursed. A tool result over TOOL_RESULT_INLINE_MAX is dropped entirely;
// the share route's /page endpoint will refuse to fetch a tool output, and the redactor defends
// against an already-uncut item that slipped through (e.g. one a future outbox version doesn't
// trim).
import { findSecret } from "./secret-detect";
import { findOpaqueToken } from "./share-redact-entropy";
import { TOOL_RESULT_INLINE_MAX } from "./cloud-sync-types";
import type { ThreadItem } from "./types";

export const REDACTED = "‹hidden: secret›";

// Loop the redactor so two adjacent patterns (a token glued to a private key) both fire. Three is
// the smallest number that catches "secret next to itself with one pattern each"; more is paranoia.
const REDACT_PASSES = 3;

// Replace every key-shaped value in `text` with `‹hidden: <kind>›`. Returns the text unchanged when
// nothing matches. Loops until a full pass produces no change (a token re-keyed by a later match
// is caught) — bounded by REDACT_PASSES so a pathological input can't loop forever.
export function redactText(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  let current = text;
  for (let i = 0; i < REDACT_PASSES; i++) {
    const next = redactOnePass(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function redactOnePass(text: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < text.length) {
    const rest = text.slice(cursor);
    // findSecret returns the first hit; replace it and scan the rest by re-running on what's left
    // through a while loop. Each replacement shortens the string, so a pathological input (a string
    // made of nothing but tokens) ends in REDACT_PASSES iterations.
    const known = findSecret(rest);
    if (known && known.value.length > 0) {
      const start = rest.indexOf(known.value);
      if (start >= 0) {
        out += rest.slice(0, start);
        out += `‹hidden: ${known.kind}›`;
        cursor += start + known.value.length;
        continue;
      }
    }
    // The pattern set didn't match: any long high-entropy run that's not a UUID or a known hash
    // shape is suspicious. This is the M-2 narrowing — a custom in-house key shape, a freshly
    // minted one-off, an internal SaaS token — that the patterns miss.
    const opaque = findOpaqueToken(rest);
    if (opaque) {
      out += rest.slice(0, opaque.index);
      out += `‹hidden: an opaque value›`;
      cursor += opaque.index + opaque.value.length;
      continue;
    }
    out += rest;
    break;
  }
  return out;
}

// An inlined file in a page: `data:image/webp;base64,…`. Its payload is random-looking by nature, so the opaque-token
// pass would chop a pasted-in photo into `‹hidden: an opaque value›` pieces and the image wouldn't render.
const DATA_URI = /data:[\w.+-]+\/[\w.+-]+(?:;[\w.+-]+=[^;,\s"')]+)*;base64,[A-Za-z0-9+/=]+/gi;

// redactText for a shared page or folder file: the text around each base64 data URI is redacted, the payloads pass
// through whole.
export function redactPageText(text: string): string {
  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(DATA_URI)) {
    out += redactText(text.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  return out + redactText(text.slice(cursor));
}

// Walk a ThreadItem and replace every string value with its redacted form. A tool item whose
// `result` is over TOOL_RESULT_INLINE_MAX is dropped entirely: the share viewer has no route to
// fetch it (an attacker could probe paths), and the redactor's defence against an uncut item is to
// remove it before it reaches the page.
export function redactItem(item: ThreadItem): ThreadItem {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return redactText(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return value;
  };
  const replaced = walk(item) as ThreadItem;
  if (replaced.kind === "tool" && typeof replaced.result === "string" && replaced.result.length > TOOL_RESULT_INLINE_MAX) {
    return withRedactedResult(replaced);
  }
  return replaced;
}

function withRedactedResult(item: Extract<ThreadItem, { kind: "tool" }>): ThreadItem {
  // Replace the long inline result with the redaction marker; everything else stays.
  const next: Record<string, unknown> = { ...item, result: REDACTED };
  return next as unknown as ThreadItem;
}

// Apply redactItem to every item in a list. Used by the live route to build the ShareLive response.
export function redactItems(items: readonly ThreadItem[]): ThreadItem[] {
  return items.map(redactItem);
}
