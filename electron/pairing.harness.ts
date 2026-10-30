// An in-memory supabase-js stand-in for the pairing tests: enough of the query builder (insert/select/update/delete,
// eq, order, limit, single, maybeSingle) over plain arrays, with the unique keys the real tables have, so a test reads
// what the desktop wrote the way the phone would.
type Row = Record<string, unknown>;

// The columns each table is unique on (its primary key or unique index), for the 23505 a real insert would get.
const UNIQUE: Record<string, string[]> = {
  devices: ["public_key"],
  workspace_keys: ["org_id", "version"],
  workspace_key_grants: ["org_id", "version", "device_id"],
};

let next = 0;
const newId = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;

// The tables the pairing code touches, always present, so a test reads them without a guard.
type Tables = Record<string, Row[]> & Record<"devices" | "phone_pairings" | "workspace_keys" | "workspace_key_grants" | "org_memberships", Row[]>;

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Tables = { devices: [], phone_pairings: [], workspace_keys: [], workspace_key_grants: [], org_memberships: [], ...seed };
  const table = (name: string) => (tables[name] ??= []);
  function from(name: string) {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    const filters: [string, unknown][] = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    let mode: "many" | "single" | "maybe" = "many";
    const matches = (r: Row) => filters.every(([c, v]) => r[c] === v);
    function run(): { data: unknown; error: { message: string; code?: string } | null } {
      const rows = table(name);
      if (op === "insert") {
        const added: Row[] = [];
        for (const raw of payload) {
          const row: Row = { id: newId(), status: name === "phone_pairings" ? "open" : undefined, ...raw };
          const keys = UNIQUE[name];
          if (keys && rows.some((r) => keys.every((k) => r[k] === row[k]))) return { data: null, error: { message: "duplicate key", code: "23505" } };
          rows.push(row);
          added.push(row);
        }
        return shape(added);
      }
      const hit = rows.filter(matches);
      if (op === "update") {
        for (const r of hit) Object.assign(r, patch);
        return shape(hit);
      }
      if (op === "delete") {
        tables[name] = rows.filter((r) => !matches(r));
        return shape(hit);
      }
      const out = [...hit];
      if (order) {
        const { col, asc } = order;
        out.sort((a, b) => ((a[col] as number) - (b[col] as number)) * (asc ? 1 : -1));
      }
      return shape(out.slice(0, limit));
    }
    function shape(rows: Row[]) {
      if (mode === "many") return { data: rows, error: null };
      if (mode === "maybe") return { data: rows[0] ?? null, error: null };
      return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } };
    }
    const b = {
      select: () => b,
      insert: (rows: Row | Row[]) => ((op = "insert"), (payload = Array.isArray(rows) ? rows : [rows]), b),
      update: (p: Row) => ((op = "update"), (patch = p), b),
      delete: () => ((op = "delete"), b),
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
      limit: (n: number) => ((limit = n), b),
      single: () => ((mode = "single"), b),
      maybeSingle: () => ((mode = "maybe"), b),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return b;
  }
  return { from, tables };
}

// safeStorage that "seals" by reversing the string, so a test can see the file isn't plain and corrupt it.
export const fakeSafeStorage = () => ({
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(Array.from(s).reverse().join("")),
  decryptString: (b: Buffer) => {
    const s = Array.from(b.toString()).reverse().join("");
    JSON.parse(s);
    return s;
  },
});
