"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatReset } from "@/lib/format";
import { limitsChart, shareLeft, type DaySlot, type LimitSample, type LimitsChart, type Mark, type Slot } from "@/lib/limit-chart";
import { BACKEND_LABELS, type Backend, type CardStats, type LimitWindow } from "@/lib/types";
import { useNow } from "@/lib/use-now";

// The plan limits across the week, in the status strip's hover over 5hr / 7d. One plot, two axes: the
// 5-hour limit left on the left axis as 168 green hour bars, the weekly limit left on the right axis as 7
// see-through red day bars in front, each topped by its burn-down edge. Red lines where a limit ran out,
// green lines at the 5-hour resets (light), the next one (strong) and the weekly reset (strongest). In a
// week's first days the last days of the week before sit on the left, shaded and dimmed.

export const CHART_WIDTH = 640;
const H = 196;
const PAD = { left: 34, right: 34, top: 16, bottom: 18 };
const BOTTOM = H - PAD.bottom;

const MARK_STYLE: Record<Mark["kind"], { stroke: string; width: number; opacity: number }> = {
  light: { stroke: "var(--ok)", width: 1, opacity: 0.3 },
  next: { stroke: "var(--ok)", width: 2.5, opacity: 0.9 },
  week: { stroke: "var(--ok)", width: 5, opacity: 1 },
  hit: { stroke: "var(--danger)", width: 2.5, opacity: 1 },
};

function useSamples(backend: Backend) {
  const [samples, setSamples] = useState<LimitSample[]>([]);
  useEffect(() => {
    let live = true;
    // ?backend: each CLI has its own plan (Claude Code on Anthropic's, puku-cli on Puku's), so the chart
    // reads only the readings of the CLI whose plan it draws.
    apiFetch(`/api/limits?backend=${backend}`)
      .then((res) => (res.ok ? res.json() : { samples: [] }))
      .then((body: { samples?: LimitSample[] }) => live && setSamples(body.samples ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [backend]);
  return samples;
}

type Scale = { x: (t: number) => number; y: (left: number) => number };

function Axes({ y }: Pick<Scale, "y">) {
  return [100, 75, 50, 25, 0].map((p) => (
    <g key={p}>
      <line x1={PAD.left} x2={CHART_WIDTH - PAD.right} y1={y(p)} y2={y(p)} stroke="var(--line)" />
      <text x={PAD.left - 4} y={y(p) + 3.5} textAnchor="end" fontSize={9} fill="var(--ok)">{p}%</text>
      <text x={CHART_WIDTH - PAD.right + 4} y={y(p) + 3.5} fontSize={9} fill="var(--danger)">{p}%</text>
    </g>
  ));
}

// The 5-hour lane: one bar per hour; an hour with an open window and no reading is hatched.
function HourBars({ hours, x, y }: Scale & { hours: Slot[] }) {
  return hours.map((s) => {
    const w = Math.max(0.5, x(s.to) - x(s.from) - 0.6);
    if (s.left === null) return null;
    if (s.left === "unknown") return <rect key={s.from} x={x(s.from) + 0.3} y={PAD.top} width={w} height={BOTTOM - PAD.top} fill="url(#limits-hatch)" />;
    return <rect key={s.from} x={x(s.from) + 0.3} y={y(s.left)} width={w} height={Math.max(1, BOTTOM - y(s.left))} fill="var(--ok)" opacity={0.85} />;
  });
}

// Where the 5-hour limit stands right now: the share left of the window open at this moment, drawn as a
// green level line across the current window with its number on it, so the number in the header ("5-hour
// 34% left") is a thing you can see in the plot instead of one you have to read off an axis. The line
// spans the open window (from its reset to the next), so it says "this level, for this stretch of time".
function NowLevel({ chart, x, y }: Scale & { chart: LimitsChart }) {
  const level = chart.fiveHourNow;
  if (level === undefined) return null;
  const { left, from, to } = level;
  // The level is drawn across the window it belongs to; the dot sits on now. A span that doesn't
  // hold now would put the dot outside the line, so nothing is drawn.
  if (to < chart.now || from > chart.now) return null;
  const x1 = x(from);
  const x2 = x(to);
  const yy = y(left);
  // The label sits above the line when there is room, below it otherwise (a level near the top).
  const above = yy - PAD.top > 16;
  return (
    <g>
      <line x1={x1} y1={yy} x2={x2} y2={yy} stroke="var(--ok)" strokeWidth={2} opacity={0.95} />
      <circle cx={x(chart.now)} cy={yy} r={3.5} fill="var(--ok)" stroke="var(--panel)" strokeWidth={1.5} />
      <text x={x(chart.now)} y={above ? yy - 7 : yy + 13} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ok)"
        stroke="var(--panel)" strokeWidth={3} paintOrder="stroke">{left}%</text>
    </g>
  );
}

// The week before's days, when the chart reaches back into them: a faint shade and a label.
function LastWeek({ chart, x }: Pick<Scale, "x"> & { chart: LimitsChart }) {
  if (chart.weekStart <= chart.start) return null;
  const x1 = x(chart.start);
  const x2 = x(chart.weekStart);
  return (
    <g>
      <rect x={x1} y={PAD.top} width={x2 - x1} height={BOTTOM - PAD.top} fill="var(--muted)" opacity={0.08} />
      <text x={(x1 + x2) / 2} y={PAD.top - 5} textAnchor="middle" fontSize={9} fill="var(--faint)">last week</text>
    </g>
  );
}

// A day's weekly bar: see-through red up to its burn-down edge, the edge drawn thick, its end % on top.
// A day of the week before is drawn at half strength.
function DayBar({ day, x, y }: Scale & { day: DaySlot }) {
  return <g opacity={day.past ? 0.5 : 1}><DayFill day={day} x={x} y={y} /></g>;
}

function DayFill({ day, x, y }: Scale & { day: DaySlot }) {
  const x1 = x(day.from) + 2;
  const x2 = x(day.to) - 2;
  if (day.left === null) return <rect x={x1} y={PAD.top} width={x2 - x1} height={BOTTOM - PAD.top} fill="var(--danger)" opacity={0.04} />;
  const first = day.edge.at(0);
  const end = day.edge.at(-1);
  if (day.left === "unknown" || !first || !end) {
    return <text x={(x1 + x2) / 2} y={(PAD.top + BOTTOM) / 2} textAnchor="middle" fontSize={10} fill="var(--faint)">no log yet</text>;
  }
  const clamp = (t: number) => Math.min(x2, Math.max(x1, x(t)));
  const top = day.edge.map(([t, l]) => `${clamp(t).toFixed(1)},${y(l).toFixed(1)}`);
  const firstX = clamp(first[0]);
  const lastX = clamp(end[0]);
  return (
    <g>
      <polygon points={[`${firstX},${BOTTOM}`, ...top, `${lastX},${BOTTOM}`].join(" ")} fill="var(--danger)" opacity={0.45} />
      <polyline points={top.join(" ")} fill="none" stroke="var(--danger)" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
      <text x={lastX} y={y(end[1]) - 7} textAnchor={lastX > x2 - 12 ? "end" : "middle"} fontSize={11} fontWeight={700} fill="var(--danger)"
        stroke="var(--panel)" strokeWidth={3} paintOrder="stroke">{end[1]}%</text>
    </g>
  );
}

function Chart({ chart }: { chart: LimitsChart }) {
  const x = (t: number) => PAD.left + ((t - chart.start) / (chart.end - chart.start)) * (CHART_WIDTH - PAD.left - PAD.right);
  const y = (left: number) => PAD.top + ((100 - left) / 100) * (BOTTOM - PAD.top);
  const nowX = x(chart.now);
  return (
    <svg width={CHART_WIDTH} height={H} viewBox={`0 0 ${CHART_WIDTH} ${H}`} className="block max-w-full" role="img" aria-label="Plan limits this week">
      <defs>
        <pattern id="limits-hatch" width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={4} stroke="var(--ok)" strokeOpacity={0.35} />
        </pattern>
      </defs>
      <Axes y={y} />
      <LastWeek chart={chart} x={x} />
      <text x={2} y={PAD.top - 5} fontSize={10.5} fontWeight={600} fill="var(--ok)">5-hour</text>
      <text x={CHART_WIDTH - 2} y={PAD.top - 5} textAnchor="end" fontSize={10.5} fontWeight={600} fill="var(--danger)">Weekly</text>
      <HourBars hours={chart.hours} x={x} y={y} />
      {chart.days.map((d) => <DayBar key={d.from} day={d} x={x} y={y} />)}
      <NowLevel chart={chart} x={x} y={y} />
      {chart.marks.map((m) => (
        <line key={`${m.kind}${m.at}`} x1={x(m.at)} x2={x(m.at)} y1={PAD.top} y2={BOTTOM} stroke={MARK_STYLE[m.kind].stroke}
          strokeWidth={MARK_STYLE[m.kind].width} opacity={MARK_STYLE[m.kind].opacity} />
      ))}
      <line x1={nowX} x2={nowX} y1={PAD.top} y2={BOTTOM} stroke="var(--muted)" strokeDasharray="2 3" />
      <text x={nowX} y={PAD.top - 5} textAnchor="middle" fontSize={9} fill="var(--muted)">now</text>
      {chart.days.map((d) => (
        <text key={d.from} x={(x(d.from) + x(d.to)) / 2} y={H - 5} textAnchor="middle" fontSize={9.5} fill="var(--faint)">
          {new Date(d.from).toLocaleDateString("en-US", { weekday: "short" })}
        </text>
      ))}
    </svg>
  );
}

function Summary({ name, window, tone, now }: { name: string; window?: LimitWindow; tone: string; now: number }) {
  if (!window) return null;
  // A reading taken before its window reset is stale: the window is full again.
  const passed = window.resetsAt !== undefined && window.resetsAt * 1000 <= now;
  return (
    <div>
      <span className={`font-semibold ${tone}`}>{name}</span> {passed ? 100 : shareLeft(window.used)}% left
      {window.resetsAt && <span className="text-muted"> · resets {formatReset(window.resetsAt, now)}</span>}
    </div>
  );
}

function Key({ color, width = 2, height = 10, opacity = 1, label }: { color: string; width?: number; height?: number; opacity?: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block" style={{ width, height, background: color, opacity }} />
      {label}
    </span>
  );
}

// One CLI's plan: `stats` holds its latest windows (lib/plan-limits.ts), the history is that CLI's readings.
export default function LimitBurndown({ backend = "claude", stats }: { backend?: Backend; stats: CardStats }) {
  const samples = useSamples(backend);
  const now = useNow();
  if (!now) return null;
  const chart = limitsChart(samples, stats, now);
  return (
    <div className="flex flex-col gap-1.5 font-sans">
      <div className="flex justify-between gap-3 text-[11.5px]">
        <span className="text-faint">{`${BACKEND_LABELS[backend]}'s plan`}</span>
        <Summary name="5-hour" window={stats.fiveHour} tone="text-ok" now={now} />
        <Summary name="Weekly" window={stats.sevenDay} tone="text-danger" now={now} />
      </div>
      <Chart chart={chart} />
      <div className="flex flex-wrap gap-x-3 text-[10.5px] text-muted">
        <Key color="var(--ok)" width={9} label="5-hour left, by hour" />
        <Key color="var(--danger)" width={9} opacity={0.6} label="weekly left, by day" />
        <Key color="var(--danger)" label="limit hit" />
        <Key color="var(--ok)" width={1} opacity={0.4} label="5-hour reset" />
        <Key color="var(--ok)" width={2.5} label="next" />
        <Key color="var(--ok)" width={5} label="weekly reset" />
      </div>
    </div>
  );
}
