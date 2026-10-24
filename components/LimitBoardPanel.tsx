"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { profileUrl } from "@/lib/league";
import { boardValue, LIMIT_BOARDS, type LimitBoard, type LimitBoardView, type LimitRow } from "@/lib/limit-board";
import { openProfile } from "./LeagueTable";

// The Leagues dialog's Limit records view: four all-time boards (fastest 5-hour and weekly burn, most of each hit),
// the top 50 and your own rank (/api/league?board=, lib/limit-board-sync.ts).

const SIGN_IN = "Sign in to Weft (top bar) to join the limit leaderboard. Only your fastest burns, when they happened and how many limits you've hit are shared, never prompts or code.";
const COLS = "grid grid-cols-[28px_32px_1fr_auto] gap-2.5";

function Row({ row, board }: { row: LimitRow; board: LimitBoard }) {
  const url = profileUrl(row.username);
  const name = <span className="truncate font-semibold text-ink">{row.name}{row.isMe && <span className="font-normal text-muted"> (you)</span>}</span>;
  return (
    <div className={`${COLS} items-center border-t border-line px-3 py-2 first:border-t-0 ${row.isMe ? "bg-accent-soft/40" : ""}`}>
      <span className="text-center text-[13px] font-bold tabular-nums text-muted">{row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : row.rank}</span>
      {row.avatar ? <img src={row.avatar} alt="" className="h-8 w-8 rounded-full" /> : <span className="h-8 w-8 rounded-full bg-sunken" />}
      <div className="flex min-w-0 flex-col">
        {url ? <button onClick={() => openProfile(url)} className="flex min-w-0 text-left hover:underline">{name}</button> : name}
        <span className="truncate text-[11px] text-muted">
          {row.at ? new Date(row.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
          {url && <span>{row.at ? " · " : ""}@{row.username}</span>}
        </span>
      </div>
      <span className="text-right text-[13px] font-semibold tabular-nums text-ink">{boardValue(board, row.value)}</span>
    </div>
  );
}

function Board({ view, board }: { view: LimitBoardView | undefined; board: LimitBoard }) {
  if (!view) return <p className="text-[12.5px] text-muted">Reading the board…</p>;
  if (view.state === "signed-out") return <p className="text-[12.5px] text-muted">{SIGN_IN}</p>;
  if (view.state === "error") return <p className="text-[12.5px] text-muted">{view.error}</p>;
  if (!view.rows.length) return <p className="text-[12.5px] text-muted">Nobody is on this board yet. Hit a limit to take first place.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      {view.rows.map((row) => (
        <Row key={row.userId} row={row} board={board} />
      ))}
    </div>
  );
}

export default function LimitBoardPanel() {
  const [board, setBoard] = useState<LimitBoard>("five_hour");
  const [views, setViews] = useState<Partial<Record<LimitBoard, LimitBoardView>>>({});

  useEffect(() => {
    if (views[board]) return;
    let live = true;
    const set = (v: LimitBoardView) => live && setViews((all) => ({ ...all, [board]: v }));
    apiFetch(`/api/league?board=${board}`)
      .then((r) => r.json() as Promise<{ board?: LimitBoardView; error?: string }>)
      .then((d) => set(d.board ?? { state: "error", error: d.error ?? "Couldn't read the board." }))
      .catch(() => set({ state: "error", error: "Couldn't reach Weft's server." }));
    return () => {
      live = false;
    };
  }, [board, views]);

  const blurb = LIMIT_BOARDS.find((b) => b.id === board)?.blurb;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {LIMIT_BOARDS.map((b) => (
          <button
            key={b.id}
            onClick={() => setBoard(b.id)}
            aria-pressed={b.id === board}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] ${b.id === board ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-ink hover:bg-sunken"}`}
          >
            {b.label}
          </button>
        ))}
      </div>
      <p className="text-[11.5px] text-muted">{blurb} · all time</p>
      <Board view={views[board]} board={board} />
    </div>
  );
}
