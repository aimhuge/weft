// The author secrets a mini app's named reads need, by name (never values): a Supabase read sends
// SUPABASE_SECRET_KEY, a GA4 report needs the property id and the service account. The Mac derives the same
// list in electron/app-data-grants.cjs `deriveNeeds` (its grant sheet); this copy is for code that can't load
// a .cjs module (the Share dialog in the browser, the weft.zip routes). The test keeps the two in step.
//
// A hosted app's reads run on weft.zip with the author's values, so these names are what Upload secrets has
// to send even when the manifest's `secrets` block is empty (Growth's is).
export function readNeeds(manifest: unknown): string[] {
  const reads = manifest && typeof manifest === "object" ? (manifest as { reads?: unknown }).reads : undefined;
  if (!reads || typeof reads !== "object" || Array.isArray(reads)) return [];
  const needs = new Set<string>();
  for (const read of Object.values(reads as Record<string, unknown>)) {
    if (!read || typeof read !== "object") continue;
    const r = read as { supabase?: unknown; ga4?: unknown };
    if (r.supabase) needs.add("SUPABASE_SECRET_KEY");
    if (r.ga4) {
      needs.add("GA4_PROPERTY_ID");
      needs.add("GA4_SERVICE_ACCOUNT_JSON");
    }
  }
  return [...needs].sort();
}
