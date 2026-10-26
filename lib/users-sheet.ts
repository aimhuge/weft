// The superadmin Users page as a sheet (@aimhuge/sheet, its SheetTable): every weft.zip account, with
// the search on the User column (name and email), filters on provider, when they joined and when they were last seen,
// and the two dates flipping newest ↔ oldest on a click. Pure.
import type { AdminUserRow } from "@/app/api/admin/users/route";
import { BLANK, TIME_ORDER, timeBucket, type SheetSpec, type SheetStateOf } from "@aimhuge/sheet";

export type UserKey = "user" | "provider" | "joined" | "seen" | "id";

// A time an account carries, as ms, or null when it has none.
export function msOf(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
}

// How long ago, as a number to sort by (newest first ascending), or null to sort with the blanks.
function ago(iso: string | null, now: number): number | null {
  const at = msOf(iso);
  return at === null ? null : now - at;
}

const timeRank = (v: string) => TIME_ORDER.indexOf(v);

export const USERS_SHEET: SheetSpec<AdminUserRow, UserKey> = {
  search: {
    key: "user",
    text: (u) => `${u.name ?? ""} ${u.email ?? ""}`,
    placeholder: "Type a name or an email…",
    hint: "Every word you type must be in the name or email",
    noun: ["account", "accounts"],
  },
  columns: [
    { key: "user", label: "User", values: (u) => [u.name ?? u.email ?? BLANK] },
    { key: "provider", label: "Provider", filter: true, values: (u) => [u.provider ?? BLANK] },
    {
      key: "joined",
      label: "Joined",
      filter: true,
      flip: true,
      sortNames: ["Newest first", "Oldest first"],
      values: (u, now) => [timeBucket(msOf(u.createdAt), now)],
      number: (u, now) => ago(u.createdAt, now),
      rank: timeRank,
    },
    {
      key: "seen",
      label: "Last seen",
      filter: true,
      flip: true,
      sortNames: ["Most recent", "Longest ago"],
      values: (u, now) => [timeBucket(msOf(u.lastSeenAt), now)],
      number: (u, now) => ago(u.lastSeenAt, now),
      rank: timeRank,
    },
    { key: "id", label: "ID", values: (u) => [u.id] },
  ],
};

// A fresh Users sheet: newest accounts first.
export const USERS_FRESH: SheetStateOf<UserKey> = { sort: { key: "joined", dir: "asc" }, hidden: {}, query: "", collapsed: [] };
