"use client";

// The delete-card confirmation's "don't ask again" preference, and the way back.
//
// The flag lives in localStorage (lib/delete-confirm.ts), so ticking it in the delete dialog is a
// one-way door: nothing else in the app would ever call rememberDeleteConfirm(false). This is that
// way back — a row in Settings → Security that says whether Weft asks before deleting a card, and
// lets you turn the question back on.
import { useState } from "react";
import { rememberDeleteConfirm, shouldConfirmDelete } from "@/lib/delete-confirm";
import { SettingsSectionHeader } from "./SettingsLayout";

export default function DeleteConfirmSwitch() {
  // The flag is read once and kept in state, so the row shows the truth and not the last render's.
  const [asks, setAsks] = useState(() => shouldConfirmDelete());

  const toggle = () => {
    const next = !asks;
    // rememberDeleteConfirm(true) means "skip the question", so asking is the opposite.
    rememberDeleteConfirm(!next);
    setAsks(next);
  };

  return (
    <section className="flex items-center justify-between gap-4">
      <SettingsSectionHeader
        title="Ask before deleting a card"
        hint="Weft's own dialog names the card and warns when its turn is running. Turn this off to delete without asking."
      />
      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[11.5px] text-muted">
        <input type="checkbox" checked={asks} onChange={toggle} className="accent-accent" />
        {asks ? "Asking" : "Not asking"}
      </label>
    </section>
  );
}
