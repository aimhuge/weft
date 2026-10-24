// The admin kit's table: dense rows on the board's tokens, a loading and an empty state, an error line, and a pager
// under it. Columns are plain objects (header + cell), so a page reads top to bottom without a table library.

import type { ReactNode } from "react";
import { Button } from "./kit";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  empty = "Nothing here yet.",
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  // With no rows, one full-width line says why: the error, still loading, or empty.
  const message = error ? <span className="text-danger">{error}</span> : loading ? "Loading…" : empty;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-sunken/60">
            {columns.map((c) => (
              <th key={c.key} className={`px-3.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-faint ${c.className ?? ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={loading && rows.length ? "opacity-60" : ""}>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-line last:border-0 hover:bg-sunken/60 ${onRowClick ? "cursor-pointer" : ""}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-3.5 py-2.5 align-middle ${c.className ?? ""}`}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3.5 py-10 text-center text-[13px] text-muted">
                {message}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {error && rows.length > 0 && <div className="border-t border-line px-3.5 py-2 text-[13px] text-danger">{error}</div>}
    </div>
  );
}

// "21–40 of 132" with Prev / Next; hidden while everything fits on one page.
export function Pager({ skip, take, total, onSkip }: { skip: number; take: number; total: number; onSkip: (skip: number) => void }) {
  if (total <= take) return null;
  const last = Math.min(skip + take, total);
  return (
    <div className="flex items-center justify-between text-[12.5px] text-muted">
      <span>
        {skip + 1}–{last} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={skip === 0} onClick={() => onSkip(Math.max(0, skip - take))}>
          ← Prev
        </Button>
        <Button size="sm" disabled={last >= total} onClick={() => onSkip(skip + take)}>
          Next →
        </Button>
      </div>
    </div>
  );
}

// A round avatar with an initial when there's no picture.
export function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) return <img src={src} alt="" className="h-7 w-7 shrink-0 rounded-full bg-sunken object-cover" />;
  return (
    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold uppercase text-accent">
      {name.trim().charAt(0) || "?"}
    </span>
  );
}
