"use client";

import Icon from "./Icon";
import "./restart.css";

// The card that asked Weft to restart (lib/restart-tool.ts): a red edge down its left side and a ⟳ chip, so the
// thread waiting on a restart is spotted in any column. A restart asked for from the menu or the palette has no
// card, and shows only the header's pill (components/RestartChip.tsx).
export function restartCardClass(requested: boolean): string {
  return requested ? "restart-stub" : "";
}

// The chip: why this card is marked, and what happens next.
export default function RestartMark({ requested }: { requested: boolean }) {
  if (!requested) return null;
  return (
    <span className="inline-flex items-center gap-1 align-[1px] text-restart" aria-label="This card asked Weft to restart">
      <Icon name="reload" size={11} />
      <span className="font-medium">Restart asked</span>
    </span>
  );
}
