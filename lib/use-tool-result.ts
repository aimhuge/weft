"use client";

// Lazy-fetch the full result of a tool call whose inline result was trimmed
// (lib/cloud-sync-types.ts TOOL_RESULT_INLINE_MAX). The row fetches it from
// /api/cards/<cardId>/thread/tool/<toolId> the first time the user opens it.
//
// fetched:
//   undefined = nothing yet (or a fetch is in flight)
//   string    = the result
//   ""        = the fetch failed
import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { apiFetch } from "./api-client";

// Where a trimmed tool result comes from. The board reads it from its own server; the weft.zip board
// provides one that reads cloud_tool_outputs through the visitor's session (components/web-board).
export type ToolResultSource = (cardId: string, toolId: string) => Promise<string>;

const localSource: ToolResultSource = (cardId, toolId) =>
  apiFetch(`/api/cards/${cardId}/thread/tool/${encodeURIComponent(toolId)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((data: { result: string }) => data.result);

export const ToolResultSourceContext = createContext<ToolResultSource>(localSource);

export interface ToolResultState {
  fetched: string | undefined;
  loading: boolean;
  errored: boolean;
}

// A byte count to a one-place human size, the way a file manager shows it.
export function toolSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Fetches the tool result the first time `details` opens. `detailsRef` is the ref the row
// renders <details> into, so we can wire the listener to its native `toggle` event.
export function useToolResult(
  cardId: string,
  toolId: string,
  trimmed: boolean,
  knownResult: string | undefined,
  detailsRef: RefObject<HTMLDetailsElement | null>,
): ToolResultState {
  const [fetched, setFetched] = useState<string | undefined>(trimmed ? undefined : knownResult);
  const source = useContext(ToolResultSourceContext);
  useEffect(() => {
    const details = detailsRef.current;
    if (!trimmed || !details) return;
    let inFlight = false;
    const onToggle = () => {
      if (!details.open || fetched !== undefined || inFlight) return;
      inFlight = true;
      source(cardId, toolId)
        .then((result) => setFetched(result))
        .catch(() => setFetched(""))
        .finally(() => {
          inFlight = false;
        });
    };
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, [trimmed, cardId, toolId, fetched, detailsRef, source]);
  const result = knownResult ?? fetched;
  return { fetched: result, loading: trimmed && result === undefined, errored: result === "" };
}
