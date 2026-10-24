"use client";

// The New thread dialog's Isolated switch (docs/architecture/worktrees.md), on the controls row beside the folder
// picker rather than a row of its own. Off: the card works in the shared folder, as every card always has. On: it gets
// a git worktree of its own from the pool and lands its branch back on Done. A dot and "Isolate?" suggest it when
// other cards are busy in the folder or the prompt is a big one.

import Icon from "./Icon";
import Tip from "./Tip";

export default function IsolateToggle({ on, suggest, onToggle }: { on: boolean; suggest: boolean; onToggle: () => void }) {
  const tip = on
    ? "Isolated: this card gets a git worktree of its own (~/.weft/worktrees), runs its tests and dev server there, and lands its branch on Done."
    : suggest
      ? "Other cards are busy in this folder, or this is a big change. Isolate it so their half-done edits can't break its tests, typecheck or dev server."
      : "Shared: this card works in the folder with the other cards. Click to give it a worktree of its own.";
  return (
    <Tip text={tip}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Isolated"
        onClick={onToggle}
        className={`relative flex items-center gap-1.5 rounded-md border py-1.5 pl-2 pr-2.5 text-[12px] font-medium ${
          on ? "border-accent/60 bg-accent/10 text-accent" : "border-line-strong text-muted hover:text-ink"
        }`}
      >
        <Icon name="branch" size={12} />
        {on ? "Isolated" : suggest ? "Isolate?" : "Shared"}
        {suggest && !on && <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warn" />}
      </button>
    </Tip>
  );
}
