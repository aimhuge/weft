// The service-role wrapper for cloud_app_secrets (supabase/migrations/20261019095618_app_hosting.sql). The table
// has RLS on with no policies and no grants, so only this module (always through the service client) may read or
// write it. The functions split names by `from: "author"` (viewer_id null) and `from: "viewer"` (the row's
// viewer_id), decrypt what the route asked for, and answer a plain { NAME: value } map. The setValue / removeValue
// pair is what /api/apps/secrets (author) and /api/a/<id>/secret (viewer) call. Values never leave a route
// unless the route asked for them by name and that name is in the manifest.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { open, seal } from "./app-secrets";

export interface AppSecretStore {
  // The names split by who provides the value. Author names: viewer_id null. Viewer names: that viewer's row.
  // Decrypts each found row and returns { NAME: value }; names with no row are simply absent (runFetch
  // notices the absence and answers 409).
  getValues(shareId: string, names: { author: string[]; viewer: string[] }, viewerId: string | null): Promise<Record<string, string>>;
  setValue(shareId: string, name: string, viewerId: string | null, value: string): Promise<void>;
  removeValue(shareId: string, name: string, viewerId: string | null): Promise<void>;
  // Whether the viewer has a row for this name: the secret form's Remove button only shows when true.
  hasValue(shareId: string, name: string, viewerId: string | null): Promise<boolean>;
}

// The columns we read; ciphertext is the only one routes never need to look at. created_at / updated_at are
// skipped so the row's wire shape stays small.
const COLUMNS = "share_id,name,viewer_id,ciphertext";

// Decrypts one row. A row that fails to open (a key rotation that lost a row, a tampered ciphertext) is logged
// and skipped: that name is missing from the result, and the route returns 409 the same as if the row didn't
// exist. A leak of a stale ciphertext is the worst case; the route never hands a half-decrypted value to the page.
function openRows(rows: { name: string; viewer_id: string | null; ciphertext: string }[], shareId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    try {
      out[row.name] = open(row.ciphertext, { shareId, name: row.name, viewerId: row.viewer_id });
    } catch (err) {
      console.error(`app-secret-store: failed to open ${shareId}/${row.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

// Reads the share's rows for the author names (viewer_id null) AND that viewer's rows for the viewer names. A
// single IN-style query against the share returns the lot, since (share_id, name) is unique with viewer_id as
// the disambiguator. We OR the name lists with the viewer filter so the query is one round-trip.
async function fetchRows(
  service: SupabaseClient,
  shareId: string,
  author: string[],
  viewer: string[],
): Promise<{ name: string; viewer_id: string | null; ciphertext: string }[]> {
  if (author.length === 0 && viewer.length === 0) return [];
  // The two halves use the same .in() chain; combine with `or` so the query is one round-trip even when
  // the lists are non-empty. A single half-omitted list would need a guard, so build the filter with care.
  const filters: string[] = [];
  if (author.length > 0) filters.push(`and(name.in.(${author.map((n) => `"${n}"`).join(",")}),viewer_id.is.null)`);
  if (viewer.length > 0) filters.push(`name.in.(${viewer.map((n) => `"${n}"`).join(",")})`);
  const { data, error } = await service
    .from("cloud_app_secrets")
    .select(COLUMNS)
    .eq("share_id", shareId)
    .or(filters.join(","));
  if (error) {
    console.error(`app-secret-store: select failed: ${error.message}`);
    return [];
  }
  return data;
}

// Split a names list against a manifest. Author names look up rows with viewer_id null; viewer names look up
// rows with the caller's viewer_id. A name missing from the manifest's split isn't in this fetch, by design.
function splitNames(
  names: string[],
  pick: (name: string) => "author" | "viewer" | null,
): { author: string[]; viewer: string[] } {
  const author: string[] = [];
  const viewer: string[] = [];
  for (const name of names) {
    const kind = pick(name);
    if (kind === "author") author.push(name);
    else if (kind === "viewer") viewer.push(name);
  }
  return { author, viewer };
}

// The store the routes use. Wraps the service client + a `pick` (how to split a name by `from`) so the route's
// caller never touches Supabase directly. setValue / removeValue / hasValue are single-row operations; they
// update-or-insert / delete one (share_id, name, viewer_id) row.
export function createAppSecretStore(service: SupabaseClient): AppSecretStore {
  return {
    async getValues(shareId, names, viewerId) {
      const all = [...names.author, ...names.viewer];
      if (all.length === 0) return {};
      const rows = await fetchRows(service, shareId, names.author, names.viewer);
      // A viewer's name may match an author row only if the manifest said `from: "viewer"` — we filter rows
      // by viewer_id so the author row (viewer_id null) never stands in for a viewer's value.
      const filtered = rows.filter((r) => {
        if (names.author.includes(r.name)) return r.viewer_id === null;
        return r.viewer_id === viewerId;
      });
      return openRows(filtered, shareId);
    },
    // Update the row, else insert it. The unique key used to be an expression index on coalesce(viewer_id, …), which
    // ON CONFLICT couldn't infer, so every upsert failed; it's UNIQUE NULLS NOT DISTINCT (share_id, name, viewer_id)
    // now. A second writer racing the insert hits that key (23505); its value then goes in through one more update.
    async setValue(shareId, name, viewerId, value) {
      const ciphertext = seal(value, { shareId, name, viewerId });
      const update = async () => {
        let q = service.from("cloud_app_secrets").update({ ciphertext }).eq("share_id", shareId).eq("name", name);
        q = viewerId === null ? q.is("viewer_id", null) : q.eq("viewer_id", viewerId);
        const { data, error } = await q.select("name");
        if (error) throw new Error(`cloud_app_secrets update failed: ${error.message}`);
        return data.length > 0;
      };
      if (await update()) return;
      // null is the column's "no viewer" value; passing it through Supabase JS preserves the NULL insert.
      const { error } = await service.from("cloud_app_secrets").insert({ share_id: shareId, name, viewer_id: viewerId, ciphertext });
      if (error?.code === "23505" && (await update())) return;
      if (error) throw new Error(`cloud_app_secrets insert failed: ${error.message}`);
    },
    async removeValue(shareId, name, viewerId) {
      let q = service.from("cloud_app_secrets").delete().eq("share_id", shareId).eq("name", name);
      if (viewerId === null) q = q.is("viewer_id", null);
      else q = q.eq("viewer_id", viewerId);
      const { error } = await q;
      if (error) throw new Error(`cloud_app_secrets delete failed: ${error.message}`);
    },
    async hasValue(shareId, name, viewerId) {
      let q = service.from("cloud_app_secrets").select("name").eq("share_id", shareId).eq("name", name).limit(1);
      if (viewerId === null) q = q.is("viewer_id", null);
      else q = q.eq("viewer_id", viewerId);
      const { data, error } = await q.maybeSingle();
      if (error) return false;
      return data !== null;
    },
  };
}

// A small helper for routes that need to split their request's name list by a manifest's `from` so the store's
// getValues receives the two halves. A name not in the map is dropped; the route's caller never asked for it.
// The parameter shape accepts whatever the manifest's rules carry alongside `from` (hosts, paths, etc.)
// — only `from` matters to the split, but the type widens to keep callers honest about the manifest.
export function splitByManifest(
  names: string[],
  secrets: Record<string, Record<string, unknown>> | null | undefined,
): { author: string[]; viewer: string[] } {
  return splitNames(names, (n) => {
    const rule = secrets?.[n];
    if (!rule) return null;
    return rule.from === "viewer" ? "viewer" : "author";
  });
}
