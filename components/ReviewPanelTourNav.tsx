"use client";

import Icon from "./Icon";

// The row under a review step's feedback box: back, send, approve, forward. Send stays on while any
// step holds unsent feedback, so a note written on an earlier step still goes out from this one.
export function ReviewPanelTourNav({
  first,
  last,
  sending,
  canSend,
  unsent,
  onPrev,
  onNext,
  onSend,
  onApprove,
}: {
  first: boolean;
  last: boolean;
  sending: boolean;
  canSend: boolean;
  unsent: number;
  onPrev: () => void;
  onNext: () => void;
  onSend: () => void;
  onApprove: () => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        onClick={onPrev}
        disabled={first}
        aria-label="Previous step"
        className="rounded-md border border-line-strong p-1.5 text-ink hover:bg-sunken disabled:opacity-40"
      >
        <Icon name="chevronLeft" size={13} />
      </button>
      <button
        onClick={onSend}
        disabled={sending || !canSend}
        title={unsent > 1 ? `Sends the feedback on all ${unsent} steps` : undefined}
        className="rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-40"
      >
        Send feedback
      </button>
      <span className="flex-1" />
      <button
        onClick={onApprove}
        className="rounded-md bg-accent px-3 py-1 text-[12.5px] font-medium text-on-accent hover:opacity-90"
      >
        {last ? "Done" : "Looks good, next"}
      </button>
      <button
        onClick={onNext}
        disabled={last}
        aria-label="Next step"
        className="rounded-md border border-line-strong p-1.5 text-ink hover:bg-sunken disabled:opacity-40"
      >
        <Icon name="chevronRight" size={13} />
      </button>
    </div>
  );
}
