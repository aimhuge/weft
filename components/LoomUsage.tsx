"use client";

import { useState } from "react";
import { burnLabel } from "@/lib/limit-board";
import { shortTokens, type UsageDay } from "@/lib/usage";

const W = 600;
const H = 110;
const TOP = 16;
const BOTTOM = 14;

function dayTip(d: UsageDay) {
  const hits = [d.fiveHour && `⏳ ${d.fiveHour} 5-hour hit${d.fiveHour > 1 ? "s" : ""}`, d.sevenDay && `🗓️ ${d.sevenDay} weekly hit${d.sevenDay > 1 ? "s" : ""}`].filter(Boolean);
  return `${d.day}: ${shortTokens(d.input + d.output)} tokens (${shortTokens(d.input)} in · ${shortTokens(d.output)} out)${hits.length ? ` · ${hits.join(" · ")}` : ""}`;
}

// The wefter card's usage chart: a bar of tokens per day (input and cache writes plus output, from every
// Claude Code and puku-cli transcript) for the last 30 days, with a dot over each day you hit a plan
// limit, amber for the 5-hour window and red for the weekly one. The hovered day reads out underneath.
type Hits = { fiveHour: number; sevenDay: number; fastest?: { fiveHour?: { ms: number }; sevenDay?: { ms: number } } };

// ", fastest 1h 12m" when a burn of that window is known.
const fastest = (b?: { ms: number }) => (b ? `, fastest ${burnLabel(b.ms)}` : "");

export default function UsageChart({ days, hits }: { days: UsageDay[]; hits: Hits }) {
  const [hover, setHover] = useState<UsageDay | null>(null);
  const peak = Math.max(1, ...days.map((d) => d.input + d.output));
  const slot = W / Math.max(1, days.length);
  const total = days.reduce((n, d) => n + d.input + d.output, 0);
  const plot = H - TOP - BOTTOM;
  return (
    <div className="flex flex-col gap-1" onMouseLeave={() => setHover(null)}>
      <div className="flex items-baseline justify-between text-[11.5px] text-muted">
        <span>
          <span className="font-semibold text-ink">Tokens, last 30 days</span> · {shortTokens(total)}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <svg width="8" height="8" aria-hidden><circle cx="4" cy="4" r="4" fill="var(--warn)" /></svg>⏳ 5-hour limit hit
            <span className="tabular-nums">({hits.fiveHour} all time{fastest(hits.fastest?.fiveHour)})</span>
          </span>
          <span className="flex items-center gap-1">
            <svg width="8" height="8" aria-hidden><circle cx="4" cy="4" r="4" fill="var(--danger)" /></svg>🗓️ weekly
            <span className="tabular-nums">({hits.sevenDay}{fastest(hits.fastest?.sevenDay)})</span>
          </span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Tokens per day and plan limit hits, last 30 days">
        <line x1={0} x2={W} y1={H - BOTTOM} y2={H - BOTTOM} stroke="var(--line)" />
        {days.map((d, i) => {
          const tokens = d.input + d.output;
          const h = tokens ? Math.max(4, (plot * tokens) / peak) : 0;
          const x = i * slot + 1;
          const w = slot - 2;
          const y = H - BOTTOM - h;
          const on = hover?.day === d.day;
          const marks = [d.fiveHour && "var(--warn)", d.sevenDay && "var(--danger)"].filter(Boolean) as string[];
          return (
            <g key={d.day} onMouseEnter={() => setHover(d)}>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {h > 0 && <path d={`M${x},${H - BOTTOM} v${-(h - 4)} q0,-4 4,-4 h${w - 8} q4,0 4,4 v${h - 4} z`} fill={on ? "var(--accent)" : "color-mix(in srgb, var(--accent) 55%, transparent)"} />}
              {marks.map((fill, k) => (
                <circle key={fill} cx={x + w / 2} cy={Math.min(y, H - BOTTOM) - 6 - k * 9} r={4} fill={fill} stroke="var(--card)" strokeWidth={2} />
              ))}
            </g>
          );
        })}
        {[days[0], days[days.length - 1]].map((d, k) =>
          d ? (
            <text key={d.day} x={k ? W : 0} y={H - 2} textAnchor={k ? "end" : "start"} fontSize={10} fill="var(--muted)">
              {d.day.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <span className="h-4 text-[11px] text-muted">{hover ? dayTip(hover) : "Input and cache writes plus output, from every Claude Code and puku transcript. Cache reads aren't counted."}</span>
    </div>
  );
}
