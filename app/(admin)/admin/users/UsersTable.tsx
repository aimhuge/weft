"use client";

// The client half of /admin/users: every weft.zip account from /api/admin/users as a sheet (the sheet kit,
// @aimhuge/sheet's SheetTable, columns in lib/users-sheet.ts). It loads every account, a couple of hundred at a
// time, so the search (name or email, typed into the User header or anywhere on the page), the filters on provider,
// joined and last seen, and the sorts all answer at once in the browser. A row opens that account's activity drawer
// (UserActivity). Built on the admin kit (components/admin).

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/admin/DataTable";
import { AdminPage, Badge } from "@/components/admin/kit";
import { SheetTable } from "@aimhuge/sheet/client";
import { timeAgo } from "@/lib/format";
import { USERS_FRESH, USERS_SHEET, msOf, type AdminUserRow, type UserKey } from "@/lib/users-sheet";
import { adminGet, day } from "../admin-api";
import UserActivityDrawer from "./UserActivity";

// How many accounts one request brings (the route's most), and how many pages it will go to.
const TAKE = 200;
const MAX_PAGES = 50;

interface Answer {
  rows: AdminUserRow[];
  total: number;
}

// Every account, page after page until the total is in; newest first, as the sheet starts.
function useAllUsers() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // Read after each await, so a page that unmounted mid-load stops writing.
    const run = { live: true };
    void (async () => {
      try {
        const all: AdminUserRow[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const params = new URLSearchParams({ skip: String(page * TAKE), take: String(TAKE), sort: "created_at desc" });
          const answer = await adminGet<Answer>(`/api/admin/users?${params}`);
          all.push(...answer.rows);
          if (!run.live) return;
          setRows([...all]);
          if (answer.rows.length < TAKE || all.length >= answer.total) break;
        }
        setError(null);
      } catch (e) {
        if (run.live) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (run.live) setLoading(false);
      }
    })();
    return () => {
      run.live = false;
    };
  }, []);
  return { rows, error, loading };
}

function seen(iso: string | null): string {
  const at = msOf(iso);
  return at === null ? "never" : timeAgo(at, Date.now());
}

const CELLS: Partial<Record<UserKey, (u: AdminUserRow) => React.ReactNode>> = {
  user: (u) => (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar src={u.avatarUrl} name={u.name ?? u.email ?? "?"} />
      <span className="flex min-w-0 flex-col">
        <span className="sheet-title truncate font-medium">{u.name ?? "—"}</span>
        <span className="truncate text-[11.5px] text-muted">{u.email ?? "no email"}</span>
      </span>
    </span>
  ),
  provider: (u) => (u.provider ? <Badge>{u.provider}</Badge> : <span className="text-faint">—</span>),
  joined: (u) => <span className="text-muted">{day(u.createdAt)}</span>,
  seen: (u) => (
    <span className="text-muted" title={u.lastSeenAt ?? ""}>
      {seen(u.lastSeenAt)}
    </span>
  ),
  id: (u) => (
    <span className="font-mono text-[11px] text-faint" title={u.id}>
      …{u.id.slice(-6)}
    </span>
  ),
};

const WIDTHS = ["minmax(0, 2.6fr)", "minmax(0, 0.9fr)", "minmax(0, 1fr)", "minmax(0, 1fr)", "88px"];

export default function UsersTable() {
  const [open, setOpen] = useState<AdminUserRow | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const { rows, error, loading } = useAllUsers();

  return (
    <AdminPage
      title="Users"
      subtitle={loading && !rows.length ? "Every weft.zip account" : `${rows.length} account${rows.length === 1 ? "" : "s"} on weft.zip${loading ? " (loading…)" : ""} · start typing to search`}
    >
      <SheetTable
        spec={USERS_SHEET}
        rows={rows}
        rowKey={(u) => u.id}
        cells={CELLS}
        widths={WIDTHS}
        storageKey="weft:admin-users-sheet"
        fresh={USERS_FRESH}
        onRowClick={setOpen}
        loading={loading}
        error={error}
        empty="No accounts yet."
        className="max-h-[calc(100vh-170px)]"
      />
      {open && <UserActivityDrawer user={open} onClose={close} />}
    </AdminPage>
  );
}
