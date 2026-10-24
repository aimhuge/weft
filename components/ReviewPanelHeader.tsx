"use client";

import Icon from "./Icon";

// The tour's header: which step you're on, how many you've approved, and how many steps still hold
// feedback you haven't sent. The last part matters: feedback written on a step you stepped away from
// is still there, and this says so rather than leaving it invisible.
export function ReviewPanelHeader({
  collapsed,
  onToggle,
  index,
  total,
  approved,
  unsent,
}: {
  collapsed: boolean;
  onToggle: () => void;
  index: number;
  total: number;
  approved: number;
  unsent: number;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-2 px-4 py-2 text-left text-[12px] font-medium text-ink"
    >
      <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={12} />
      Review
      <span className="font-normal text-muted">
        step {Math.min(index + 1, total)} of {total} · {approved} approved
      </span>
      {unsent > 0 && (
        <span className="font-normal text-warn">
          · {unsent} step{unsent === 1 ? "" : "s"} with unsent feedback
        </span>
      )}
    </button>
  );
}
