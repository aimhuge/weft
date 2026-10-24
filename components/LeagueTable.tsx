"use client";

import { LEAGUES } from "@/lib/game";
import { profileUrl, zoneOf, type LeagueRow } from "@/lib/league";
import Tip from "./Tip";

// What the profile's League tab and the Leagues dialog share: the six-tier ladder and a league's table, best
// first, with each builder's week (XP, shipped, streak, badges earned since Monday) and a link to their weft.zip/@username.

// Cotton to Gold Thread, taller as they go. `tier` is yours (tiers above it are locked); with `onPick` every
// tier is a button and `picked` is the one shown.
export function Ladder({ tier, picked, onPick }: { tier: number | null; picked?: number; onPick?: (tier: number) => void }) {
  return (
    <div className="flex items-end gap-1.5">
      {LEAGUES.map((name, i) => {
        const here = i === (picked ?? tier);
        const open = tier !== null && i <= tier;
        const cls = `flex flex-1 items-end justify-center rounded-t-md border border-b-0 pb-1.5 text-[11.5px] ${
          here ? "border-accent bg-accent-soft font-semibold text-accent" : open ? "border-line bg-sunken text-ink" : "border-dashed border-line bg-sunken text-muted"
        }`;
        const label = (
          <>
            {open ? name : `🔒 ${name}`}
            {i === tier && picked !== undefined && picked !== tier && <span className="ml-1 text-[10px] font-normal">· you</span>}
          </>
        );
        const style = { height: 34 + i * 12 };
        return onPick ? (
          <button key={name} onClick={() => onPick(i)} aria-pressed={here} className={`${cls} ${here ? "" : "hover:border-accent hover:text-ink"}`} style={style}>
            {label}
          </button>
        ) : (
          <div key={name} className={cls} style={style}>
            {label}
          </div>
        );
      })}
    </div>
  );
}

export function openProfile(url: string) {
  if (window.weft?.openExternal) window.weft.openExternal(url);
  else window.open(url, "_blank", "noreferrer");
}

const COLS = "grid grid-cols-[28px_32px_1fr_auto_64px] gap-2.5";

function Row({ row, size, tier }: { row: LeagueRow; size: number; tier: number }) {
  const zone = zoneOf(row, size, tier);
  const url = profileUrl(row.username);
  const name = <span className="truncate font-semibold text-ink">{row.name}{row.isMe && <span className="font-normal text-muted"> (you)</span>}</span>;
  return (
    <div className={`${COLS} items-center border-t border-line px-3 py-2 first:border-t-0 ${row.isMe ? "bg-accent-soft/40" : ""}`}>
      <span className={`text-center text-[13px] font-bold tabular-nums ${zone === "up" ? "text-green-500" : zone === "down" ? "text-red-500" : "text-muted"}`}>
        {row.rank}
      </span>
      {row.avatar ? <img src={row.avatar} alt="" className="h-8 w-8 rounded-full" /> : <span className="h-8 w-8 rounded-full bg-sunken" />}
      <div className="flex min-w-0 flex-col">
        {url ? (
          <button onClick={() => openProfile(url)} className="flex min-w-0 text-left hover:underline">
            {name}
          </button>
        ) : (
          name
        )}
        <span className="truncate text-[11px] text-muted">
          Level {row.level} · {row.shipped} shipped{row.streak > 0 ? ` · 🔥 ${row.streak}` : ""}
          {url && <span> · @{row.username}</span>}
        </span>
      </div>
      <div className="flex max-w-[180px] flex-wrap justify-end gap-0.5">
        {row.badges.map((b) => (
          <Tip key={b.name} text={b.name}>
            <span className="text-[15px]">{b.icon}</span>
          </Tip>
        ))}
      </div>
      <span className="text-right text-[13px] font-semibold tabular-nums text-ink">{row.xp.toLocaleString()}</span>
    </div>
  );
}

// "Linen League · week of … · 3 builders" over "top 1 move up · bottom 0 move down"; `title` overrides the name.
export function LeagueHead({ league, week, size, up, down, title }: { league: string; week: string; size: number; up: number; down: number; title?: string }) {
  return (
    <div className="flex items-baseline justify-between text-[12px] text-muted">
      <span>
        <span className="font-semibold text-ink">{title ?? `${league} League`}</span> · week of {week} · {size} {size === 1 ? "builder" : "builders"}
      </span>
      <span>
        {up > 0 && <span className="text-green-500">top {up} move up</span>}
        {up > 0 && down > 0 && " · "}
        {down > 0 && <span className="text-red-500">bottom {down} move down</span>}
      </span>
    </div>
  );
}

export function LeagueTable({ rows, tier }: { rows: LeagueRow[]; tier: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className={`${COLS} bg-sunken px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-muted`}>
        <span className="text-center">#</span>
        <span />
        <span>Builder</span>
        <span className="text-right">Badges this week</span>
        <span className="text-right">XP</span>
      </div>
      {rows.map((row) => (
        <Row key={row.userId} row={row} size={rows.length} tier={tier} />
      ))}
    </div>
  );
}
