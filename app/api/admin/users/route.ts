// The Users admin page's data source. Returns paginated rows of weft.zip
// accounts (auth.users joined to profiles) for the table. The admin gate
// (@/lib/admin) has already verified the caller is a super-admin; the service
// client is what reads across users (RLS on profiles allows only self-read).
import { adminServiceClient, requireSuperAdminWeft } from "@/lib/admin";
import { fail, guard } from "@/lib/guard";
import type { AdminUserRow } from "@/lib/users-sheet";
import { normalizeEmail } from "@aimhuge/teams";

// The row type lives with the sheet that reads it (lib/users-sheet.ts); re-exported here for the
// admin page's own importers.
export type { AdminUserRow };

const PAGE_SIZE = 20;
// The most one request may take: the Users sheet loads every account in pages this size and sorts and filters them
// in the browser. Kept well under what one profiles lookup (an in.(...) list of ids in the URL) can carry.
const MAX_TAKE = 200;
const MAX_SKIP = 100 * PAGE_SIZE;

// A user as GoTrue's admin API returns it (auth.admin.listUsers). auth.users
// isn't reachable through PostgREST (the auth schema isn't exposed), so the
// route reads it this way. `user_metadata` has had three shapes over the years.
interface AuthUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: { provider?: unknown } | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
}

interface AuthAdmin {
  listUsers(params: { page: number; perPage: number }): Promise<{ data: { users: AuthUser[] } | null; error: unknown }>;
}

interface ProfileRow {
  id: string;
  name: string | null;
  avatar_url: string | null;
}

type SortColumn = "created_at" | "last_seen_at" | "email";

// The whitelisted sort columns. Anything else would be an injection surface. last_sign_in_at is the old name for
// "Recently seen", kept so a saved link still sorts.
const SORTABLE: Record<string, SortColumn> = {
  created_at: "created_at",
  last_seen_at: "last_seen_at",
  last_sign_in_at: "last_seen_at",
  email: "email",
};

// listUsers pages hold up to 1000; ten of them is far past weft.zip's size, and
// a cap keeps a runaway answer from looping forever.
const LIST_PAGE = 1000;
const MAX_LIST_PAGES = 10;

function parseSort(sort: string): { column: SortColumn; dir: "asc" | "desc" } {
  const parts = sort.split(/\s+/, 2);
  // split() always answers at least one element, so the first part is always a string; an empty one
  // is a column nobody may sort by, and falls back with the rest.
  const field: string = parts[0] as string;
  const dir = parts[1] === "asc" ? "asc" : "desc";
  return { column: SORTABLE[field] ?? "created_at", dir };
}

function parseInt32(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function pickString(meta: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

function mapUserToRow(
  u: AuthUser,
  profiles: Map<string, { name: string | null; avatar_url: string | null }>,
  lastSeen: Map<string, string>,
): AdminUserRow {
  const meta = u.user_metadata ?? {};
  const profile = profiles.get(u.id);
  const provider = typeof u.app_metadata?.provider === "string" ? u.app_metadata.provider : null;
  return {
    id: u.id,
    email: u.email ?? null,
    name: profile?.name ?? pickString(meta, "full_name", "name", "user_name"),
    avatarUrl: profile?.avatar_url ?? pickString(meta, "avatar_url", "picture"),
    provider,
    createdAt: u.created_at ?? null,
    lastSignInAt: u.last_sign_in_at ?? null,
    lastSeenAt: seenAt(u, lastSeen),
  };
}

async function loadProfilesFor(
  service: { from: (t: string) => { select: (cols: string) => unknown } },
  ids: string[],
): Promise<Map<string, { name: string | null; avatar_url: string | null }>> {
  const map = new Map<string, { name: string | null; avatar_url: string | null }>();
  if (ids.length === 0) return map;
  // The duck-typed `service` shape (selected fields the route reads) is a
  // property, not a type, of SupabaseClient; the union of all the from/select
  // chains we build would force TS into infinite generics.
  const chain = service.from("profiles").select("id, name, avatar_url") as { in: (col: string, ids: string[]) => Promise<{ data: ProfileRow[] | null }> };
  const { data: profiles } = await chain.in("id", ids);
  for (const p of profiles ?? []) map.set(p.id, { name: p.name, avatar_url: p.avatar_url });
  return map;
}

async function listAllUsers(admin: AuthAdmin): Promise<AuthUser[]> {
  const all: AuthUser[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: LIST_PAGE });
    if (error) throw new Error((error as { message?: string }).message ?? "Couldn't list the users.");
    const users = data?.users ?? [];
    all.push(...users);
    if (users.length < LIST_PAGE) break;
  }
  return all;
}

function seenAt(u: AuthUser, lastSeen: Map<string, string>): string | null {
  return lastSeen.get(u.id) ?? u.last_sign_in_at ?? null;
}

// Each account's last activity from admin_users_last_seen. An error (the migration not applied yet) answers an empty
// map, so the page falls back to sign-in times rather than failing.
async function loadLastSeen(service: { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await service.rpc("admin_users_last_seen");
  if (error || !Array.isArray(data)) return map;
  for (const r of data as Array<{ user_id?: unknown; last_seen_at?: unknown }>) {
    // PostgREST answers timestamptz as "2026-10-25T17:48:29+00:00"; ISO with Z keeps the string sort right.
    if (typeof r.user_id === "string" && typeof r.last_seen_at === "string") map.set(r.user_id, new Date(r.last_seen_at).toISOString());
  }
  return map;
}

function compareBy(column: SortColumn, dir: "asc" | "desc", lastSeen: Map<string, string>) {
  const sign = dir === "asc" ? 1 : -1;
  const value = (u: AuthUser) => (column === "last_seen_at" ? seenAt(u, lastSeen) : u[column]) ?? "";
  // Missing values sort last either way, like Postgres's NULLS LAST on desc.
  return (a: AuthUser, b: AuthUser) => {
    // Emails compare case-blind; the ISO timestamps compare as strings.
    const x = value(a).toLowerCase();
    const y = value(b).toLowerCase();
    if (x === y) return 0;
    if (x === "") return 1;
    if (y === "") return -1;
    return x < y ? -sign : sign;
  };
}

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  try {
    await requireSuperAdminWeft();
    const url = new URL(req.url);
    const skip = Math.min(Math.max(parseInt32(url.searchParams.get("skip"), 0), 0), MAX_SKIP);
    const take = Math.min(Math.max(parseInt32(url.searchParams.get("take"), PAGE_SIZE), 1), MAX_TAKE);
    const q = (url.searchParams.get("q") ?? "").trim();
    const sort = parseSort(url.searchParams.get("sort") ?? "created_at desc");
    const service = await adminServiceClient();
    if (!service) {
      return Response.json(
        {
          error: "SUPABASE_SECRET_KEY is not set. The Users admin page needs the service role on the deployed weft.",
          rows: [],
          total: 0,
        },
        { status: 503 },
      );
    }

    const emailTerm = q ? normalizeEmail(q) : "";

    const all = await listAllUsers((service as unknown as { auth: { admin: AuthAdmin } }).auth.admin);
    const matching = emailTerm ? all.filter((u) => normalizeEmail(u.email ?? "").includes(emailTerm)) : all;
    const lastSeen = await loadLastSeen(service);
    const pageUsers = [...matching].sort(compareBy(sort.column, sort.dir, lastSeen)).slice(skip, skip + take);
    const profiles = await loadProfilesFor(service, pageUsers.map((u) => u.id));
    const rows = pageUsers.map((u) => mapUserToRow(u, profiles, lastSeen));

    return Response.json({ rows, total: matching.length });
  } catch (err) {
    return fail(err);
  }
}
