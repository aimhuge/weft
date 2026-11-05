"use client";

// The drawer a row on /admin/users opens: one account's last 12 weeks from /api/admin/users/[id]/activity. A
// calendar of active days (shaded by cards run when the account syncs them), cards per day, streaks and what the
// account has made. Esc or the backdrop closes it, before AdminEscape would leave the page.

import { useEffect, useState } from "react";
import { Avatar } from "@/components/admin/DataTable";
import { Badge, Button, Notice, type Tone } from "@/components/admin/kit";
import { lifecycle, weekColumns, type ActivityDay, type ActivitySummary, type Lifecycle, type UserActivity } from "@/lib/admin-activity";
import { timeAgo } from "@/lib/format";
import { useEscape } from "@/lib/use-escape";
import type { AdminUserRow } from "@/lib/users-sheet";
import { adminGet, day } from "../admin-api";

type Answer = UserActivity & { summary: ActivitySummary };

const LIFECYCLE: Record<Lifecycle, [Tone, string]> = {
  never: ["neutral", "never signed in"],
  new: ["accent", "new this week"],
  active: ["ok", "active"],
  dormant: ["warn", "dormant"],
  gone: ["danger", "gone 30d+"],
};

const WEEKDAYS = ["M", "", "W", "", "F", "", "S"];

// Each answer is kept with the id it's for, so another row's drawer reads "Loading…" rather than the last account.
function useActivity(id: string) {
  const [got, setGot] = useState<{ id: string; answer?: Answer; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    adminGet<Answer>(`/api/admin/users/${id}/activity`)
      .then((answer) => live && setGot({ id, answer }))
      .catch((e: unknown) => live && setGot({ id, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [id]);
  const mine = got?.id === id ? got : null;
  return { answer: mine?.answer ?? null, error: mine?.error ?? null };
}

// Shaded by cards run when the account syncs them; a flat accent for a day it only had Weft open.
function cellStyle(d: ActivityDay, peak: number) {
  if (!d.active) return undefined;
  const strength = peak > 0 && d.cards > 0 ? 0.35 + 0.65 * Math.sqrt(d.cards / peak) : peak > 0 ? 0.25 : 0.85;
  return { opacity: strength };
}

function Calendar({ days, peak }: { days: ActivityDay[]; peak: number }) {
  const weeks = weekColumns(days);
  return (
    <div className="flex gap-[3px]">
      <div className="mr-1 flex flex-col gap-[3px] text-[9px] leading-[13px] text-faint">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="h-[13px]">
            {w}
          </span>
        ))}
      </div>
      {weeks.map((week, i) => (
        <div key={i} className="flex flex-col gap-[3px]">
          {week.map((d, j) =>
            d ? (
              <div key={j} title={`${d.day}: ${d.active ? (d.cards ? `${d.cards} cards` : "active") : "no activity"}`} className="relative h-[13px] w-[13px] rounded-[3px] bg-sunken">
                {d.active && <div className="absolute inset-0 rounded-[3px] bg-accent" style={cellStyle(d, peak)} />}
              </div>
            ) : (
              <div key={j} className="h-[13px] w-[13px]" />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

// Cards per day over the last 30 days; only drawn when the account syncs cards.
function CardBars({ days, peak }: { days: ActivityDay[]; peak: number }) {
  const recent = days.slice(-30);
  return (
    <div className="flex h-16 items-end gap-[2px]">
      {recent.map((d) => (
        <div key={d.day} title={`${d.day}: ${d.cards} cards`} className="flex-1 rounded-t-[2px] bg-accent/80" style={{ height: `${(d.cards / peak) * 100}%` }} />
      ))}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-line px-3 py-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{label}</span>
      <span className="text-[17px] font-semibold leading-tight">{value}</span>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  );
}

function Body({ a }: { a: Answer }) {
  const s = a.summary;
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Active 7d" value={`${s.active7}/7`} />
        <Tile label="Active 30d" value={`${s.active30}/30`} />
        <Tile label="Streak" value={`${s.streak}d`} hint={`longest ${s.longest}d`} />
      </div>
      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Last 12 weeks</h3>
        <Calendar days={a.days} peak={s.peakCards} />
        {a.firstActiveDay && <span className="text-[11.5px] text-muted">History from {day(a.firstActiveDay)}</span>}
      </section>
      {s.peakCards > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Cards per day, last 30 · peak {s.peakCards}</h3>
          <CardBars days={a.days} peak={s.peakCards} />
        </section>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Cards" value={a.cards} hint="synced" />
        <Tile label="Devices" value={a.sessions} hint="signed in" />
        <Tile label="Workspaces" value={a.workspaces} />
        <Tile label="Shares" value={a.shares} />
        <Tile label="Apps" value={a.apps} />
        <Tile label="Invites" value={a.invitesSent} hint="sent" />
      </div>
      {a.pukuRequests > 0 && <span className="text-[12px] text-muted">{a.pukuRequests} Puku trial requests</span>}
    </>
  );
}

export default function UserActivityDrawer({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const { answer, error } = useActivity(user.id);
  const [now] = useState(() => Date.now());
  const [tone, label] = LIFECYCLE[lifecycle(user.lastSeenAt, user.createdAt, now)];

  // Esc closes the drawer, and AdminEscape (which skips handled keys) stays on the page: the repo's one Escape
  // stack, whose top layer is the newest one up.
  useEscape(true, onClose);

  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      <button aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative flex h-full w-[380px] max-w-full flex-col gap-4 overflow-y-auto border-l border-line bg-panel px-5 py-4 text-[13px] text-ink shadow-xl">
        <div className="flex items-start gap-2.5">
          <Avatar src={user.avatarUrl} name={user.name ?? user.email ?? "?"} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">{user.name ?? user.email ?? "—"}</span>
            <span className="truncate text-[12px] text-muted">{user.email}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
              <Badge tone={tone}>{label}</Badge>
              seen {user.lastSeenAt ? timeAgo(Date.parse(user.lastSeenAt), now) : "never"} · joined {day(user.createdAt)}
            </span>
          </div>
          <Button size="sm" onClick={onClose} title="Close (Esc)">
            ✕
          </Button>
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : answer ? <Body a={answer} /> : <span className="text-muted">Loading…</span>}
      </aside>
    </div>
  );
}
