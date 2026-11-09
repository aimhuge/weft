"use client";

// The 🔐 drawer's "To fill in" list: every blank in the vault, across environments, in one group above its values
// (lib/vault-blanks.ts). Folded to its header when the vault has values to show, so twenty blanks don't bury them;
// open while searching, while a blank is being filled in, or when there are only a few.
import { useState } from "react";
import { blankNote, blanksOpenByDefault, type BlankRow } from "@/lib/vault-blanks";
import type { VaultSecret } from "@/lib/vault-view";
import Icon from "./Icon";

export function VaultBlanks({
  blanks,
  values,
  query,
  editing,
  row,
}: {
  blanks: BlankRow[];
  // How many values the vault shows beside them.
  values: number;
  query: string;
  // A blank's Fill in form is open: the list stays open around it.
  editing: boolean;
  row: (s: VaultSecret, note?: string | null) => React.ReactNode;
}) {
  const [picked, setPicked] = useState<boolean | null>(null);
  if (!blanks.length) return null;
  const open = editing || (picked ?? blanksOpenByDefault(blanks.length, values, query));
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setPicked(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded px-1.5 pb-0.5 pt-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-warn hover:text-ink"
      >
        <Icon name={open ? "chevronDown" : "chevronRight"} size={10} />
        To fill in · {blanks.length}
      </button>
      {open && blanks.map((b) => row(b.secret, blankNote(b)))}
    </div>
  );
}
