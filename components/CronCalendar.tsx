"use client";

import { useState } from "react";
import { midnight, monthGrid, sameDay } from "@/lib/cron-form";

const HEAD = ["M", "T", "W", "T", "F", "S", "S"];

// The ⏰ popover's month: click a day to start from it; violet dots mark the runs to come, so the repeat rule is easy
// to check by eye. Days before today can't be picked.
export default function CronCalendar({ start, runs, now, onPick }: { start: number; runs: number[]; now: number; onPick: (day: number) => void }) {
  const [month, setMonth] = useState(() => {
    const d = new Date(start);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const shift = (by: number) => setMonth(({ y, m }) => ({ y: m + by < 0 ? y - 1 : m + by > 11 ? y + 1 : y, m: (m + by + 12) % 12 }));
  const today = midnight(now);
  const label = new Date(month.y, month.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div className="w-[168px] shrink-0 rounded-md border border-line p-1.5">
      <div className="mb-1 flex items-center justify-between text-[11.5px] font-medium text-ink">
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="rounded px-1 text-muted hover:bg-sunken">‹</button>
        <span>{label}</span>
        <button type="button" aria-label="Next month" onClick={() => shift(1)} className="rounded px-1 text-muted hover:bg-sunken">›</button>
      </div>
      <table className="w-full border-collapse text-center text-[10.5px]">
        <thead>
          <tr>{HEAD.map((d, i) => <th key={i} className="h-4 font-normal text-faint">{d}</th>)}</tr>
        </thead>
        <tbody>
          {monthGrid(month.y, month.m).map((week, w) => (
            <tr key={w}>
              {week.map((day, i) => {
                if (day === null) return <td key={i} />;
                const picked = sameDay(day, start);
                const runs_ = runs.some((r) => sameDay(r, day));
                const past = day < today;
                return (
                  <td key={i} className="p-0">
                    <button
                      type="button"
                      disabled={past}
                      onClick={() => onPick(day)}
                      aria-label={new Date(day).toDateString()}
                      aria-pressed={picked}
                      className={`relative h-[19px] w-full rounded ${picked ? "bg-[var(--cron)] font-semibold text-white" : past ? "text-faint/50" : runs_ ? "font-semibold text-cron hover:bg-sunken" : "text-ink hover:bg-sunken"}`}
                    >
                      {new Date(day).getDate()}
                      {runs_ && !picked && <span className="absolute bottom-0 left-1/2 size-[3px] -translate-x-1/2 rounded-full bg-[var(--cron)]" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
