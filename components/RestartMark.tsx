"use client";

import Icon from "./Icon";
import Tip from "./Tip";
import "./restart.css";

// The card that asked Weft to restart (lib/restart-tool.ts): a thin red ring and a ⟳ pill before its title, the
// same pill the header shows, so the thread waiting on a restart is spotted in any column. A restart asked for from
// the menu or the palette has no card, and shows only the header's pill (components/RestartChip.tsx).
export function restartCardClass(requested: boolean): string {
  return requested ? "restart-asked" : "";
}

// The pill: why this card is marked, and what happens next.
export default function RestartMark({ requested }: { requested: boolean }) {
  if (!requested) return null;
  return (
    <Tip
      text="This thread asked Weft to restart. Weft restarts once the running threads finish; click the pill in the header to cancel."
      className="mr-1 inline-flex align-[1px]"
    >
      <span
        className="inline-flex items-center gap-1 rounded-full border border-danger/40 bg-danger-soft px-1.5 text-[10.5px] font-medium leading-[16px] text-danger"
        aria-label="This card asked Weft to restart"
      >
        <Icon name="reload" size={10} />
        Restart asked
      </span>
    </Tip>
  );
}
