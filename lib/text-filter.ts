// The one rule every filter box in Weft uses: a row matches when its text holds every word of the query,
// in any case and any order ("stripe hook" finds STRIPE_WEBHOOK_SECRET). A blank query matches everything.
// `split` is what separates words; the 🔐 drawer also splits on "_" so env-var names read as words.

export function queryWords(query: string, split: RegExp = /\s+/): string[] {
  return query.toLowerCase().split(split).filter(Boolean);
}

// The fields a row is searched by; missing ones count as empty.
export function matchesQuery(fields: (string | null | undefined)[], query: string, split?: RegExp): boolean {
  const text = fields.map((f) => f ?? "").join(" ").toLowerCase();
  return queryWords(query, split).every((w) => text.includes(w));
}

// The rows a query leaves, in their order; a blank query returns the list itself.
export function filterByQuery<T>(rows: T[], query: string, fields: (row: T) => (string | null | undefined)[], split?: RegExp): T[] {
  if (!queryWords(query, split).length) return rows;
  return rows.filter((row) => matchesQuery(fields(row), query, split));
}
