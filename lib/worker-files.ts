"use client";

// The editor column's files for a card on a Weft Worker (docs/architecture/project-hosts.md, H4): the same calls as
// this Mac's (lib/client-files.ts), each a host verb (files.list, files.read, files.write) sent through this Mac's
// server and followed to its result, whose value comes back inline or from the blob store (lib/host-result.ts).
//
// - No live reload: a stat would be a round trip to the worker every two seconds, so `live` is false and the editor
//   doesn't poll; reopening the file reads it again. Thread and project events over the WebRTC line (H6) bring it back.
// - The file index is read at most once a minute per card: the thread's file links ask for it as the thread grows.
// - One the worker hasn't run within a few seconds fails rather than waits (askWorker), and says so.
// - A save rides in the command's payload, which is capped at 200 KB, so a larger file is refused before it's sent.
import { apiFetch } from "./api-client";
import { FileConflictError, type FileStat, type OpenedFile, type SaveResult } from "./client-files";
import type { FilesSource } from "./files-source";
import type { HostVerb } from "./host-api/types";
import { askWorker } from "./worker-acts";

export const WRITE_MAX = 150_000;
export const LIST_TTL_MS = 60_000;

// How a verb reaches the worker and comes back with its `result`: the relay's askWorker, or the session line's `host`
// channel when it's up (lib/line-host.ts askOnLine). Either carries the same HostResult, `value` or `blob`.
export type AskHost = (verb: HostVerb, args: { id: string } & Record<string, unknown>) => Promise<unknown>;

// One verb's value: in the result, or in the blob store when it was too big for the row (lib/host-result.ts), read back
// through this Mac's server.
export async function askFiles<T>(verb: HostVerb, args: { id: string } & Record<string, unknown>, ask: AskHost = askWorker): Promise<T> {
  const result = (await ask(verb, args)) as { value?: T; blob?: string } | null | undefined;
  if (!result?.blob) return result?.value as T;
  const res = await apiFetch(`/api/worker-board?blob=${encodeURIComponent(result.blob)}`);
  const body = (await res.json().catch(() => ({}))) as { value?: T; error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.value as T;
}

const sources: { lists: Map<string, unknown> }[] = [];

// The editor's files over one route. Each keeps its own file indexes.
export function workerFilesVia(ask: AskHost): FilesSource {
  const lists = new Map<string, { at: number; files: Promise<string[]> }>();
  sources.push({ lists });
  const asked = <T>(verb: HostVerb, args: { id: string } & Record<string, unknown>) => askFiles<T>(verb, args, ask);

  function list(cardId: string, now = Date.now()): Promise<string[]> {
    const known = lists.get(cardId);
    if (known && now - known.at < LIST_TTL_MS) return known.files;
    const files = asked<{ files: string[] }>("files.list", { id: cardId }).then((r) => r.files);
    lists.set(cardId, { at: now, files });
    // A failed read isn't kept: the next one asks again.
    files.catch(() => lists.delete(cardId));
    return files;
  }

  const read = (cardId: string, path: string) => asked<{ file: OpenedFile }>("files.read", { id: cardId, path }).then((r) => r.file);

  async function write(cardId: string, path: string, text: string, baseHash?: string | null): Promise<SaveResult> {
    if (text.length > WRITE_MAX) throw new Error(`The editor saves files up to ${String(WRITE_MAX / 1000)} KB on a worker. Ask the card to make this change.`);
    const out = await asked<{ result: SaveResult } | { conflict: OpenedFile }>("files.write", { id: cardId, path, text, baseHash });
    if ("conflict" in out) throw new FileConflictError(out.conflict);
    // A new file joins the index.
    lists.delete(cardId);
    return out.result;
  }

  return {
    read,
    stat: (cardId, path): Promise<FileStat> => read(cardId, path).then(({ exists, mtime, size }) => ({ exists, mtime, size })),
    head: (cardId, path) => asked<{ text: string | null }>("files.read", { id: cardId, path, at: "HEAD" }).then((r) => r.text),
    list: (cardId) => list(cardId),
    write,
    live: false,
  };
}

// Over the relay: what the board uses when no line is known for the worker.
export const workerFiles = workerFilesVia(askWorker);

// For tests: forget the cached file indexes.
export const forgetLists = () => sources.forEach((s) => s.lists.clear());
