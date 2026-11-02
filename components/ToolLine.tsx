"use client";

import { useRef, type ReactNode } from "react";
import { useFindReveal } from "@/lib/find-reveal";
import { openFile } from "@/lib/open-file";
import { shortToolName } from "@/lib/format";
import { toolSizeLabel, useToolResult } from "@/lib/use-tool-result";
import type { ThreadItem } from "@/lib/types";
import { EditDiff } from "./EditDiff";
import Icon, { Spinner } from "./Icon";
import MediaView from "./MediaView";

type ToolCall = Extract<ThreadItem, { kind: "tool" }>;

// The summary's path, when the tool named a file: a button that opens it in the editor column
// (a Read opens the file; an edit opens its diff against git HEAD). stopPropagation keeps the
// click from toggling the surrounding <details>.
function ToolSummaryPath({ item, cardId }: { item: ToolCall; cardId: string }) {
  const path = item.file;
  if (!path) return <>{item.summary}</>;
  return (
    <button
      type="button"
      data-testid="tool-open-file"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        openFile({ cardId, path, diff: Boolean(item.edit) });
      }}
      title={`Open ${path}`}
      className="cursor-pointer text-ink underline decoration-dotted underline-offset-2 hover:text-accent"
    >
      {item.summary}
    </button>
  );
}

function ToolEditChip({ edit }: { edit: NonNullable<ToolCall["edit"]> }) {
  return (
    <span className="shrink-0 font-mono text-[11px]" title={`+${edit.added} −${edit.removed}`}>
      <span className="text-ok">+{edit.added}</span> <span className="text-danger">−{edit.removed}</span>
    </span>
  );
}

function ToolOpenDiff({ cardId, path }: { cardId: string; path: string }) {
  return (
    <div className="flex items-center gap-2 border-t border-line px-2.5 py-1.5 text-[11px] text-faint">
      <button
        type="button"
        data-testid="tool-open-diff"
        onClick={(e) => {
          e.stopPropagation();
          openFile({ cardId, path, diff: true });
        }}
        className="hover:text-ink"
      >
        Open diff
      </button>
    </div>
  );
}

// A tool row's body: the inline diff when the call edits a file, the raw result otherwise. An
// error result still shows so the failure isn't hidden.
function toolBody(args: {
  showEdit: boolean;
  edit: ToolCall["edit"];
  fetched: string | undefined;
  loading: boolean;
  errored: boolean;
  trimmed: boolean;
}): ReactNode {
  if (args.showEdit && args.edit) return <div className="border-t border-line p-2"><EditDiff edit={args.edit} /></div>;
  if (args.fetched) {
    return (
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-line px-2.5 py-2 font-mono text-[11.5px] leading-snug text-muted">
        {args.fetched}
      </pre>
    );
  }
  if (args.loading) {
    return (
      <div className="flex items-center gap-2 border-t border-line px-2.5 py-2 text-[11.5px] text-faint">
        <Spinner size={10} /> Loading result…
      </div>
    );
  }
  if (args.errored) return <div className="border-t border-line px-2.5 py-2 text-[11.5px] text-danger">Couldn&apos;t load the result.</div>;
  if (args.trimmed) return <div className="border-t border-line px-2.5 py-2 text-[11.5px] text-faint">Click to load the result.</div>;
  return null;
}

// The right-hand indicator on a tool row's summary: a spinner while it's running, a "failed"
// chip when it errored, nothing once the result is in.
function toolIndicator(fetched: string | undefined, live: boolean, trimmed: boolean, isError?: boolean) {
  if (fetched !== undefined) return isError ? <span className="text-danger">failed</span> : null;
  if (live && !trimmed) return <span className="text-faint"><Spinner size={10} /></span>;
  return null;
}

export default function ToolLine({ item, live, cardId }: { item: ToolCall; live: boolean; cardId: string }) {
  // The server trimmed a long result out of the item (lib/cloud-sync-types.ts TOOL_RESULT_INLINE_MAX);
  // the hook fetches it from /api/cards/<id>/thread/tool/<toolId> the first time the row opens.
  const trimmed = item.result === undefined && item.resultBytes !== undefined;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { fetched, loading, errored } = useToolResult(cardId, item.id, trimmed, item.result, detailsRef);
  const showEdit = Boolean(item.edit) && !item.isError;
  const body = toolBody({ showEdit, edit: item.edit, fetched, loading, errored, trimmed });
  const indicator = toolIndicator(fetched, live, trimmed, item.isError);
  // Find opens the row on its match, which also fetches a trimmed result; left undefined, the row is the user's to toggle.
  const found = useFindReveal([item]);
  return (
    <details ref={detailsRef} open={found || undefined} className="rounded-md border border-line bg-sunken">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[12px]">
        <Icon name="wrench" size={12} className="text-faint" />
        <span className="shrink-0 font-mono font-medium text-ink">{shortToolName(item.name)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted">
          <ToolSummaryPath item={item} cardId={cardId} />
        </span>
        {item.edit && <ToolEditChip edit={item.edit} />}
        {item.resultBytes !== undefined && <span className="shrink-0 text-faint">{toolSizeLabel(item.resultBytes)}</span>}
        {indicator}
      </summary>
      {body}
      {showEdit && item.file && <ToolOpenDiff cardId={cardId} path={item.file} />}
      {item.images && (
        <div className="flex flex-wrap gap-2 border-t border-line p-2">
          {item.images.map((src) => (
            <MediaView key={src} src={src} alt="Screenshot" thumb={(item.images?.length ?? 0) > 1} />
          ))}
        </div>
      )}
    </details>
  );
}
