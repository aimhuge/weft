"use client";

import { useEffect, useState } from "react";
import { openFile } from "@/lib/open-file";
import type { EditPreview } from "@/lib/edit-preview";
import type { PendingPermission, PromptReason } from "@/lib/types";
import CardFace, { type Face } from "./CardFace";
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

// A clash shows who is in whose way first: the holder's face, then this thread's.
function Faces({ holder, me }: { holder: NonNullable<PromptReason["holder"]>; me?: Face }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5" data-testid="clash-faces">
      <CardFace face={holder} tip={holder.first ? `‘${holder.title}’ goes first on this file` : `‘${holder.title}’ is editing this code`} />
      {me && (
        <>
          <span aria-hidden className="text-[10px] text-faint">›</span>
          <CardFace face={me} tip={`‘${me.title}’ (this thread) wants to edit it`} />
        </>
      )}
    </span>
  );
}

function Reason({ why, me }: { why: PromptReason; me?: Face }) {
  const { label, tip } = REASONS[why.category];
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[12px]" title={tip}>
      {why.holder && <Faces holder={why.holder} me={me} />}
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
  me,
}: {
  input: Record<string, unknown>;
  // Why the prompt came up (lib/claims.ts clashWhy, lib/runner-ask.ts modeWhy).
  why?: PromptReason;
  edit?: EditPreview;
  // The plan page (lib/plan-preview.ts); shown as a clickable link and opened in the card's pane.
  previewUrl?: string;
  // The asking card's title, its one-line intent.
  askedBy?: string;
  // The asking card's face, beside the holder's on a clash.
  me?: Face;
}) {
  const [raw, setRaw] = useState(false);
  const cardId = useFileLink();
  // Open the plan in the pane as soon as the prompt lands; a click re-opens it at the same place.
  const bridge = typeof window !== "undefined" ? window.weft : undefined;
  useEffect(() => {
    if (previewUrl && bridge && cardId) void bridge.browser.open(previewUrl, cardId).catch(() => {});
  }, [previewUrl, bridge, cardId]);
  const reason = why && <Reason why={why} me={me} />;
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

// The prompt's buttons. An edit another card is holding offers the order, not a refusal: Wait first
// (lib/permission-wait.ts) holds this edit until the holder lets go, This first (lib/precedence.ts) goes
// ahead and has the holder leave the file to this thread, and Others first puts the holder ahead —
// this thread leaves the file to it and waits. Deny stays for prompts that aren't a clash, where
// refusing the call is the question.
export function PermissionActions({
  pending,
  answered,
  onAnswer,
  onWait,
  onFirst,
  onOtherFirst,
  onGrant,
}: {
  pending: PendingPermission;
  answered: boolean;
  onAnswer: (allow: boolean) => void;
  // Wait on a symbol claim; left out where the thread's transport can't (weft.zip), so only the order shows.
  onWait?: () => void;
  // This first on a symbol claim; left out where the transport can't (weft.zip), like Wait.
  onFirst?: () => void;
  // Others first: the holder of the code goes ahead and this thread waits for it.
  onOtherFirst?: () => void;
  // A folder outside the project (pending.readScope): allow it for this card or for every card, then answer yes.
  onGrant?: (scope: "card" | "always") => void;
}) {
  const holder = pending.why?.holder;
  const deny = (
    <button onClick={() => onAnswer(false)} disabled={answered} className={SECONDARY}>
      Deny
    </button>
  );
  // This first, or a plain Go ahead where the transport has no This first.
  const ahead = (primary: boolean) =>
    onFirst ? (
      <button onClick={onFirst} disabled={answered} className={primary ? PRIMARY : SECONDARY} title={`Go ahead, and ‘${holder?.title}’ leaves this file to this thread until it commits or finishes`}>
        This first
      </button>
    ) : (
      <button onClick={() => onAnswer(true)} disabled={answered} className={SECONDARY}>
        Go ahead
      </button>
    );
  // Others first: the holder keeps the file and goes ahead; this thread waits for it. Where the transport
  // can't say it (weft.zip), Wait is the same order the long way round.
  const otherFirst = onOtherFirst ? (
    <button onClick={onOtherFirst} disabled={answered} className={SECONDARY} title={`Let ‘${holder?.title}’ go first: it keeps this file, and this thread waits until it commits or finishes`}>
      Others first
    </button>
  ) : null;
  if (holder && pending.waiting)
    return (
      <div className="mt-2 flex items-center gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <Spinner size={12} />
          <span className="truncate">Waiting for ‘{holder.title}’ to finish…</span>
        </span>
        <span className="ml-auto flex shrink-0 gap-2">
          {ahead(true)}
          {otherFirst ?? deny}
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
  if (holder)
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {onWait && (
          <button onClick={onWait} disabled={answered} className={PRIMARY} title={`Hold this edit until ‘${holder.title}’ finishes or commits, then redo it on top`}>
            Wait
          </button>
        )}
        {ahead(!onWait)}
        {otherFirst ?? deny}
      </div>
    );
  return (
    <div className="mt-2 flex gap-2">
      <button onClick={() => onAnswer(true)} disabled={answered} className={PRIMARY}>
        Allow
      </button>
      {deny}
    </div>
  );
}
