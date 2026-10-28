// The fakes the shared-vault tests share: a supabase-js stand-in that records the rows the desktop
// would write, and the vault's crypto ready to use.
//
// The crypto module is handed in rather than required (the way electron/vault-store.cjs takes it), so
// a test and the code under it share one instance of it — a second copy would have its own libsodium,
// which nobody awaited.

/** A row the fake wrote, with the table it went to. */
export interface Written {
  table: string;
  op: string;
  row: Record<string, unknown>;
}

/** The options the fake answers a read with. */
export interface FakeOptions {
  pending?: Record<string, unknown> | null;
  device?: Record<string, unknown> | null;
  grant?: Record<string, unknown> | null;
  rpc?: string;
}

/** The account client the fake stands in for, and the rows it was asked to write. */
export interface FakeSupabase {
  written: Written[];
  client: {
    supabase: {
      from: (table: string) => Record<string, unknown>;
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null }>;
    };
    getClaims: () => { sub: string; email: string };
  };
}

// A supabase-js stand-in that records the rows the desktop would write. The query builder is
// chainable, so a call like .select().eq().eq().order().limit().maybeSingle() reads one row.
export function fakeSupabase(opts: FakeOptions = {}): FakeSupabase {
  const written: Written[] = [];
  // A builder that answers one row and can be filtered in any order.
  const one = (row: Record<string, unknown> | null | undefined) => {
    const builder: Record<string, unknown> = {};
    builder.eq = () => builder;
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: row ?? null, error: null });
    builder.single = () => Promise.resolve({ data: row ?? null, error: null });
    return builder;
  };
  const tables: Record<string, Record<string, unknown>> = {
    pending_device_grants: { select: () => one(opts.pending) },
    devices: { select: () => one(opts.device) },
    vault_grants: {
      select: () => one(opts.grant),
      upsert: (row: Record<string, unknown>) => {
        written.push({ table: "vault_grants", op: "upsert", row });
        return Promise.resolve({ data: [row], error: null });
      },
    },
    vault_secrets: {
      upsert: (row: Record<string, unknown>) => {
        written.push({ table: "vault_secrets", op: "upsert", row });
        return Promise.resolve({ data: row, error: null });
      },
    },
  };
  return {
    written,
    client: {
      supabase: {
        from: (table: string) => tables[table] ?? {},
        rpc: (name: string, args: Record<string, unknown>) => {
          written.push({ table: "rpc", op: name, row: args });
          return Promise.resolve({ data: opts.rpc ?? "vault-1", error: null });
        },
      },
      getClaims: () => ({ sub: "user-1", email: "user@example.com" }),
    },
  };
}

// The row the fake was asked to write, or null when it wasn't asked to. The shape is the caller's to
// say: the fake records what it was handed and doesn't decide what that is, so a test casts it.
export function rowFor(written: Written[], table: string): unknown {
  return written.find((w) => w.table === table)?.row ?? null;
}
