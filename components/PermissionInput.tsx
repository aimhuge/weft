"use client";

import { useEffect, useState } from "react";
import { openFile } from "@/lib/open-file";
import type { EditPreview } from "@/lib/edit-preview";
import type { PendingPermission, PromptReason } from "@/lib/types";
import { EditDiff } from "./EditDiff";
import { useFileLink } from "./file-link-context";
import { Spinner } from "./Icon";

// The body of a permission prompt: first why it came up (a symbol-claim clash, or the card's permission
// mode), then the change. A held Edit or Write reads as a change: who asks, the file, the
// symbols it touches, +added −removed and a short diff with real line breaks (lib/edit-preview.ts).
// A plan (ExitPlanMode) renders as a one-line link to a pane page (lib/plan-preview.ts); the user reads
// the plan in the browser pane where it has room, while Allow / Deny stay in the thread.
// Any other tool, or Raw, shows the tool's input as JSON.

// A claim's symbol as the prompt shows it: `Board/useEffect#3` reads `Board › useEffect #3`.
export function symbolLabel(symbol: string) {
  return symbol
    .split("/")
    .map((part) => part.replace(/#(\d+)$/, " #$1"))
    .join(" › ");
}

const SHARED = "Cards share one working tree: going ahead can undo or tangle with that card's uncommitted change; waiting lets it finish first.";

// Each reason's chip and its tooltip, which carries the explanation every clash shares.
export const REASONS: Record<PromptReason["category"], { label: string; tip: string }> = {
  "same-code": { label: "Same code", tip: `This edit changes code another busy card changed. ${SHARED}` },
  overlap: { label: "Overlapping code", tip: `This edit and another busy card's change sit one inside the other. ${SHARED}` },
  "whole-file": { label: "Whole file", tip: `One side rewrites the whole file another busy card is editing. ${SHARED}` },
  mode: { label: "Permission mode", tip: "This card's permission mode asks before this tool. Change it from the thread header." },
  classifier: { label: "Auto mode blocked", tip: "Auto mode's classifier denied this call itself, so it never asked. Allow it once and the thread retries it; Keep denied leaves it." },
  outside: { label: "Outside project", tip: "This reaches a folder beyond the card's project. Allow it once, for this card, or for every card." },
};

function Reason({ why }: { why: PromptReason }) {
  const { label, tip } = REASONS[why.category];
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[12px]" title={tip}>
      <span className="shrink-0 rounded bg-warn px-1.5 text-[10.5px] font-bold uppercase leading-[18px] tracking-wide text-[#1a1410]">⚠ {label}</span>
      <span className="min-w-0 truncate text-muted">{why.detail}</span>
    </div>
  );
}

const PRE = "max-h-36 overflow-auto rounded bg-panel/70 px-2 py-1.5 font-mono text-[11px]";

export default function PermissionInput({
  input,
  edit,
  previewUrl,
  askedBy,
  why,
}: {
  input: Record<string, unknown>;
  // Why the prompt came up (lib/claims.ts clashWhy, lib/runner-ask.ts modeWhy).
  why?: PromptReason;
  edit?: EditPreview;
  // The plan page (lib/plan-preview.ts); shown as a clickable link and opened in the card's pane.
  previewUrl?: string;
  // The asking card's title, its one-line intent.
  askedBy?: string;
}) {
  const [raw, setRaw] = useState(false);
  const cardId = useFileLink();
  // Open the plan in the pane as soon as the prompt lands; a click re-opens it at the same place.
  const bridge = typeof window !== "undefined" ? window.weft : undefined;
  useEffect(() => {
    if (previewUrl && bridge && cardId) void bridge.browser.open(previewUrl, cardId).catch(() => {});
  }, [previewUrl, bridge, cardId]);
  const reason = why && <Reason why={why} />;
  if (previewUrl && !edit) {
    const open = () => {
      if (cardId) void bridge?.browser.open(previewUrl, cardId).catch(() => {});
    };
    return (
      <div className="mt-1.5 flex flex-col gap-1">
        {reason}
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <span>Plan opened in the pane — read it there, then Allow or Deny below.</span>
          <button
            type="button"
            onClick={open}
            className="shrink-0 cursor-pointer font-medium text-accent hover:underline"
          >
            Show in pane
          </button>
          <button
            type="button"
            onClick={() => setRaw((r) => !r)}
            aria-pressed={raw}
            className="shrink-0 rounded px-1 text-[11px] text-faint hover:bg-sunken hover:text-ink"
          >
            Raw
          </button>
        </div>
        {raw ? <pre className={`whitespace-pre-wrap text-muted ${PRE}`}>{JSON.stringify(input, null, 2)}</pre> : null}
      </div>
    );
  }
  if (!edit)
    return (
      <div className="mt-1.5 flex flex-col gap-1">
        {reason}
        <pre className={`whitespace-pre-wrap text-muted ${PRE}`}>{JSON.stringify(input, null, 2)}</pre>
      </div>
    );
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {reason}
      <div className="flex min-w-0 items-baseline gap-2 text-[12px]">
        <span className="min-w-0 truncate text-muted" title={edit.file}>
          {askedBy && <span className="text-ink">‘{askedBy}’ </span>}
          {edit.creates ? "creates " : "changes "}
          {cardId ? (
            <button
              type="button"
              data-testid="permission-open-file"
              onClick={() => openFile({ cardId, path: edit.file, diff: true })}
              className="cursor-pointer font-mono text-ink underline decoration-dotted underline-offset-2 hover:text-accent"
            >
              {edit.file}
            </button>
          ) : (
            <span className="font-mono text-ink">{edit.file}</span>
          )}
          {edit.symbols && (
            <>
              {" in "}
              <span className="font-mono text-ink">{edit.symbols.map(symbolLabel).join(", ")}</span>
            </>
          )}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px]">
          <span className="text-ok">+{edit.added}</span> <span className="text-danger">−{edit.removed}</span>
        </span>
        <button
          type="button"
          onClick={() => setRaw((r) => !r)}
          aria-pressed={raw}
          className="shrink-0 rounded px-1 text-[11px] text-faint hover:bg-sunken hover:text-ink"
        >
          Raw
        </button>
      </div>
      {raw ? <pre className={`whitespace-pre-wrap text-muted ${PRE}`}>{JSON.stringify(input, null, 2)}</pre> : <EditDiff edit={edit} />}
    </div>
  );
}

const PRIMARY = "rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50";
const SECONDARY = "rounded-md border border-line-strong bg-panel px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

// The prompt's buttons. An edit another card is holding offers Wait first (lib/permission-wait.ts): going
// ahead can undo that card's uncommitted change. While it waits, Go ahead and Deny still answer it.
export function PermissionActions({
  pending,
  answered,
  onAnswer,
  onWait,
  onGrant,
}: {
  pending: PendingPermission;
  answered: boolean;
  onAnswer: (allow: boolean) => void;
  // Wait on a symbol claim; left out where the thread's transport can't (weft.zip), so only Go ahead and Deny show.
  onWait?: () => void;
  // A folder outside the project (pending.readScope): allow it for this card or for every card, then answer yes.
  onGrant?: (scope: "card" | "always") => void;
}) {
  const holder = pending.why?.holder;
  const deny = (
    <button onClick={() => onAnswer(false)} disabled={answered} className={SECONDARY}>
      Deny
    </button>
  );
  if (holder && pending.waiting)
    return (
      <div className="mt-2 flex items-center gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <Spinner size={12} />
          <span className="truncate">Waiting for ‘{holder.title}’ to finish…</span>
        </span>
        <span className="ml-auto flex shrink-0 gap-2">
          <button onClick={() => onAnswer(true)} disabled={answered} className={SECONDARY}>
            Go ahead now
          </button>
          {deny}
        </span>
      </div>
    );
  // Auto mode's classifier denied it already (lib/classifier-denial.ts): allowing it retries the call once.
  if (pending.why?.category === "classifier")
    return (
      <div className="mt-2 flex gap-2">
        <button onClick={() => onAnswer(true)} disabled={answered} className={PRIMARY} title="Let this exact call through once and have the thread retry it">
          Allow once and retry
        </button>
        <button onClick={() => onAnswer(false)} disabled={answered} className={SECONDARY}>
          Keep denied
        </button>
      </div>
    );
  if (pending.readScope && onGrant)
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={() => onAnswer(true)} disabled={answered} className={PRIMARY}>
          Allow once
        </button>
        <button onClick={() => onGrant("card")} disabled={answered} className={SECONDARY} title={`Let this card use ${pending.readScope.token} from now on`}>
          This card
        </button>
        <button onClick={() => onGrant("always")} disabled={answered} className={SECONDARY} title={`Let every card use ${pending.readScope.token} from now on`}>
          Always
        </button>
        {deny}
      </div>
    );
  return (
    <div className="mt-2 flex gap-2">
      {holder && onWait && (
        <button onClick={onWait} disabled={answered} className={PRIMARY} title={`Hold this edit until ‘${holder.title}’ finishes or commits, then redo it on top`}>
          Await resolution
        </button>
      )}
      <button onClick={() => onAnswer(true)} disabled={answered} className={holder && onWait ? SECONDARY : PRIMARY}>
        {holder ? "Go ahead" : "Allow"}
      </button>
      {deny}
    </div>
  );
}
