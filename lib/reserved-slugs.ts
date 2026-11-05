// The names a workspace slug can never take: workspaces live at the URL root (/<slug>/board), so a slug that
// matches a root route would 404 behind the static page. One list, two users: lib/team-create.ts freeSlug()
// and private.org_slug_for in the database (the latest migration that redefines it; reserved-slugs.test.ts
// checks its array is exactly this list, so a new app/ folder fails until a migration catches up).
//
// It's @aimhuge/teams' RESERVED_SLUGS plus Weft's own root folders (lib/app-routes.ts allReserved(), which its
// test keeps in step with app/), plus root names Weft has retired but keeps off-limits.
import { RESERVED_SLUGS } from "@aimhuge/teams";
import { allReserved } from "./app-routes";

// Root routes Weft once had (the old vault page), still reserved so an old link never lands on a workspace.
const RETIRED_ROOTS = ["vault"];

// Only slug-shaped names: slugify() never makes _next or favicon.ico, so they'd only clutter the SQL array.
const SLUG_SHAPE = /^[a-z0-9-]+$/;

export const RESERVED_WORKSPACE_SLUGS: readonly string[] = [
  ...new Set([...RESERVED_SLUGS, ...allReserved(), ...RETIRED_ROOTS].map((s) => s.toLowerCase())),
]
  .filter((s) => SLUG_SHAPE.test(s))
  .sort();

const RESERVED = new Set(RESERVED_WORKSPACE_SLUGS);

// True when a workspace can't have this slug: too short, or one of the reserved names.
export function isReservedWorkspaceSlug(slug: string): boolean {
  return slug.length < 2 || RESERVED.has(slug.toLowerCase());
}
