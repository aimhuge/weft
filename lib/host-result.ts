// A host command's result when its verb answers with a value (docs/architecture/project-hosts.md, H4): the editor's
// files.list, files.read and files.write. The row's `result` is plain jsonb capped at 4 KB (a check constraint, so a
// writer can't park a large blob on a table every board polls), and a file or a folder's index is usually larger. So a
// small value rides in `result.value`, and a larger one goes up to the workspace's blob store as JSON, content
// addressed, with `result.blob` naming its sha; the board reads it back with the account's own session.
import type { HostVerb } from "./host-api";
import type { HostResult } from "./host-command";

// What fits in the row beside the rest of the result, with room to spare under the 4 KB check.
export const INLINE_MAX = 3_000;

// The verbs whose reply is the point, not a side effect: the editor's, a thread's reads and the host's card list.
export const carriesValue = (verb: HostVerb) => verb.startsWith("files.") || verb.startsWith("thread.") || verb === "card.list";

// Puts a value's JSON in the blob store, answering its sha (lib/blob-store.ts uploadJson, through the worker's route).
export type Carry = (json: string) => Promise<string>;

export async function valueResult(cardId: string, value: unknown, carry: Carry | undefined): Promise<HostResult> {
  const json = JSON.stringify(value ?? null);
  if (Buffer.byteLength(json) <= INLINE_MAX) return { ok: true, cardId, value: value ?? null };
  if (!carry) throw new Error("This host can't send a large result back yet. Update it to the newest Weft.");
  return { ok: true, cardId, blob: await carry(json) };
}

// The value a result names: inline, or read from the blob store. Undefined for a result with neither.
export async function resultValue(result: unknown, readJson: (sha: string) => Promise<string | null>): Promise<unknown> {
  const r = result && typeof result === "object" ? (result as { value?: unknown; blob?: unknown }) : {};
  if (typeof r.blob === "string" && /^[0-9a-f]{64}$/.test(r.blob)) {
    const json = await readJson(r.blob);
    if (json === null) throw new Error("That result isn't in the blob store.");
    return JSON.parse(json) as unknown;
  }
  return r.value;
}
