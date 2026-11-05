"use client";

// The sheet's row: the numbered gutter on the left and the row's content beside it. Every row of the
// list view is one of these — a card, a subagent, a cron's run — so the grid lines up down the sheet.
// Purely a wrapper; the row's own look (nested, dragging) comes in as extra class names.

export interface SheetRowProps extends React.HTMLAttributes<HTMLDivElement> {
  // What the gutter holds: the row's number, or nothing for a row the gutter doesn't number.
  gutter?: React.ReactNode;
  // Extra class names on the row itself, for a nested row or one being dragged.
  className?: string;
  // The gutter's own class names.
  gutterClassName?: string;
  children: React.ReactNode;
}

export default function SheetRow({ gutter, className, gutterClassName, children, ...rest }: SheetRowProps) {
  return (
    <div className={["sheet-row", "flex", className].filter(Boolean).join(" ")} {...rest}>
      <span className={["sheet-gutter", gutterClassName].filter(Boolean).join(" ")} aria-hidden>
        {gutter}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
