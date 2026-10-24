// Every app link gets an address under its owner (weft.zip/@<user>/apps/<slug>), not only the ones whose slug
// field was edited: Share… shows the default slug in the field, and a link that went up without one copied as the
// bare /a/<id>. The default is the app's folder name when the page sits in ~/.weft/apps/<slug>/, else
// appSlugFrom(app.name); a taken one tries <slug>-2 … <slug>-9 before giving up on a slug (the link still works
// under /a/<id>, and the dialog's slug field can name one).
import { appSlugFrom } from "./app-share-types";
import type { AppShareRow, Ready } from "./app-share-row";
import type { MiniApp } from "./mini-apps";

const TRIES = 9;

// The folder slug from a file:///path/.weft/apps/<slug>/<entry> URL, or null when it doesn't match.
function folderSlug(url: string): string | null {
  const m = url.match(/^file:\/\/.+?\/\.weft\/apps\/([^/]+)\/[^/?#]+/);
  return m?.[1] ?? null;
}

export function defaultAppSlug(app: Pick<MiniApp, "url" | "name">): string {
  return (app.url.startsWith("file:") ? folderSlug(app.url) : null) ?? appSlugFrom(app.name);
}

// growth, growth-2 … growth-9, each kept within the 40-character slug rule.
export function slugCandidates(base: string): string[] {
  const out = [base];
  for (let n = 2; n <= TRIES; n++) out.push(`${base.slice(0, 40 - `-${n}`.length).replace(/-+$/, "")}-${n}`);
  return out;
}

// Postgres's unique-index violation, as Supabase reports it.
export function isDuplicateSlug(err: { message: string } | null): boolean {
  if (!err) return false;
  return /duplicate key|already exists/i.test(err.message);
}

// Runs write with each candidate slug until one isn't taken; when all are, once more with no slug. Any other
// error ends the run and comes back as is.
export async function writeWithFreeSlug(
  base: string,
  write: (slug: string | null) => Promise<{ message: string } | null>,
): Promise<{ message: string } | null> {
  for (const slug of slugCandidates(base)) {
    const error = await write(slug);
    if (!isDuplicateSlug(error)) return error;
  }
  return write(null);
}

// A link that went up without a slug (before every link got one) gets its default now, best effort: the row as
// it stands when nothing could be written.
export async function backfillSlug(t: Ready, row: AppShareRow): Promise<AppShareRow> {
  if (row.slug) return row;
  for (const slug of slugCandidates(defaultAppSlug(t.app))) {
    const result = (await t.client.from("cloud_app_shares").update({ slug }).eq("id", row.id)) as { error: { message: string } | null };
    if (!result.error) return { ...row, slug };
    if (!isDuplicateSlug(result.error)) return row;
  }
  return row;
}
