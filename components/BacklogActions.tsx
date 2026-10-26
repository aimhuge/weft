"use client";

import { useState } from "react";
import type { Card } from "@/lib/types";
import { sprintActions } from "@/lib/use-sprints";
import Icon from "./Icon";
import Modal from "./Modal";
import Tip from "./Tip";

// What the Backlog column's header needs from the board.
export interface BacklogLane {
  // The Backlog's unarchived cards the board shows (project and filter applied).
  cards: readonly Card[];
  // Every card on the board, for what each saved sprint holds.
  allCards: readonly Card[];
  onArchiveAll: () => void;
  // Unarchives these cards (a sprint's Restore).
  onRestore: (ids: string[]) => void;
  toast: (message: string) => void;
  notify: (err: unknown) => void;
  // Folds the column to a thin strip (components/FoldedColumn.tsx), there even while it's empty.
  onFold?: () => void;
}

const plural = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

// Saves the lane's cards as a sprint and says so; the sprints list under "Backlog" shows it.
export async function saveLaneAsSprint(lane: BacklogLane) {
  const sprint = await sprintActions.save(lane.cards.map((c) => c.id));
  lane.toast(`Saved ${plural(lane.cards.length)} as “${sprint.name}”`);
}

// The Backlog header's actions: Save as sprint (the flag) and Archive all (the box), which asks first,
// then Fold (the chevron), which tucks the column away.
export default function BacklogActions({ lane }: { lane: BacklogLane }) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const n = lane.cards.length;
  const fold = lane.onFold && <FoldButton onFold={lane.onFold} />;
  if (!n) return fold || null;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await saveLaneAsSprint(lane);
    } catch (err) {
      lane.notify(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <span className="@max-[230px]:hidden inline-flex">
        <Tip text={`Save these ${plural(n)} as a sprint. Click “Backlog” for your sprints.`} className="inline-flex">
          <button onClick={() => void save()} disabled={saving} className="rounded p-0.5 hover:bg-hover hover:text-ink disabled:opacity-50" aria-label={`Save the ${plural(n)} in Backlog as a sprint`}>
            <Icon name="flag" size={13} />
          </button>
        </Tip>
      </span>
      <Tip text={`Archive all ${n} in Backlog`} className="inline-flex">
        <button onClick={() => setConfirming(true)} className="rounded p-0.5 hover:bg-hover hover:text-ink" aria-label={`Archive all ${n} in Backlog`}>
          <Icon name="archive" size={13} />
        </button>
      </Tip>
      {confirming && <ConfirmArchive lane={lane} onClose={() => setConfirming(false)} />}
      {fold}
    </>
  );
}

function FoldButton({ onFold }: { onFold: () => void }) {
  return (
    <Tip text="Fold Backlog to a strip. Click the strip to open it again." className="inline-flex">
      <button onClick={onFold} className="rounded p-0.5 hover:bg-hover hover:text-ink" aria-label="Fold Backlog">
        <Icon name="chevronLeft" size={13} />
      </button>
    </Tip>
  );
}

// "Are you sure?" before the whole lane goes. Saving it as a sprint first keeps a way back besides Undo.
function ConfirmArchive({ lane, onClose }: { lane: BacklogLane; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const n = lane.cards.length;
  const archive = () => {
    lane.onArchiveAll();
    onClose();
  };
  async function saveThenArchive() {
    setBusy(true);
    try {
      await saveLaneAsSprint(lane);
      archive();
    } catch (err) {
      lane.notify(err);
      setBusy(false);
    }
  }
  return (
    <Modal title={`Archive all ${n} in Backlog?`} onClose={onClose} className="w-full max-w-[440px]">
      <div className="px-5 py-4 text-[13px] leading-relaxed text-muted">
        {n === 1 ? "The card leaves" : `All ${plural(n)} leave`} the board. Undo brings them back right after; a saved sprint&apos;s
        Restore brings them back any time.
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:bg-sunken hover:text-ink">Cancel</button>
        <button onClick={() => void saveThenArchive()} disabled={busy} className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink hover:bg-sunken disabled:opacity-50">
          Save as sprint, then archive
        </button>
        <button autoFocus onClick={archive} disabled={busy} className="rounded-md bg-danger px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50">
          Archive all
        </button>
      </div>
    </Modal>
  );
}
