"use client";

// The client half of /admin/users: every weft.zip account from /api/admin/users, searchable by email, sortable,
// a page of 20 at a time. Built on the admin kit (components/admin).

import { useEffect, useState } from "react";
import { Avatar, DataTable, Pager, type Column } from "@/components/admin/DataTable";
import { AdminPage, Badge, Input, Select } from "@/components/admin/kit";
import type { AdminUserRow } from "@/app/api/admin/users/route";
import { timeAgo } from "@/lib/format";
import { adminGet, day } from "../admin-api";

const TAKE = 20;

const SORTS: Array<[string, string]> = [
  ["created_at desc", "Newest"],
  ["created_at asc", "Oldest"],
  ["last_sign_in_at desc", "Recently seen"],
  ["email asc", "Email A–Z"],
];

function seen(iso: string | null): string {
  return iso ? timeAgo(Date.parse(iso), Date.now()) : "never";
}

const columns: Column<AdminUserRow>[] = [
  {
    key: "user",
    header: "User",
    cell: (u) => (
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar src={u.avatarUrl} name={u.name ?? u.email ?? "?"} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{u.name ?? "—"}</span>
          <span className="truncate text-[12px] text-muted">{u.email ?? "no email"}</span>
        </div>
      </div>
    ),
  },
  { key: "provider", header: "Provider", cell: (u) => (u.provider ? <Badge>{u.provider}</Badge> : <span className="text-faint">—</span>) },
  { key: "joined", header: "Joined", cell: (u) => <span className="text-muted">{day(u.createdAt)}</span>, className: "whitespace-nowrap" },
  { key: "seen", header: "Last seen", cell: (u) => <span className="text-muted" title={u.lastSignInAt ?? ""}>{seen(u.lastSignInAt)}</span>, className: "whitespace-nowrap" },
  { key: "id", header: "ID", cell: (u) => <span className="font-mono text-[11px] text-faint" title={u.id}>…{u.id.slice(-6)}</span>, className: "w-0" },
];

interface Answer {
  rows: AdminUserRow[];
  total: number;
}

function useUsers(q: string, sort: string, skip: number) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    // Debounced so typing in the search doesn't fire a request per key.
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ skip: String(skip), take: String(TAKE), sort });
      if (q) params.set("q", q);
      adminGet<Answer>(`/api/admin/users?${params}`)
        .then((a) => {
          if (!live) return;
          setAnswer(a);
          setError(null);
        })
        .catch((e: unknown) => {
          if (live) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, sort, skip]);
  return { answer, error, loading };
}

export default function UsersTable() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("created_at desc");
  const [skip, setSkip] = useState(0);
  const { answer, error, loading } = useUsers(q.trim(), sort, skip);
  const total = answer?.total ?? 0;

  return (
    <AdminPage title="Users" subtitle={answer ? `${total} account${total === 1 ? "" : "s"}${q.trim() ? " match" : " on weft.zip"}` : "Every weft.zip account"}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-0 flex-1"
          placeholder="Search by email"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSkip(0);
          }}
        />
        <Select
          aria-label="Sort"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setSkip(0);
          }}
        >
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        columns={columns}
        rows={answer?.rows ?? []}
        rowKey={(u) => u.id}
        loading={loading}
        error={error}
        empty={q.trim() ? `No account's email contains “${q.trim()}”.` : "No accounts yet."}
      />
      <Pager skip={skip} take={TAKE} total={total} onSkip={setSkip} />
    </AdminPage>
  );
}
