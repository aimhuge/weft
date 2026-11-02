import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ accountClient: () => fake({ session: null }) }));
const { workerDevServers } = await import("./worker-dev-list");

const server = { cardId: "c1", folder: "weft", command: "pnpm dev", state: "running", startedAt: 1, source: "weft" };

type Session = { user: { id: string } } | null;
const ME: Session = { user: { id: "me" } };

function fake({ session = ME, rows = [] as unknown[], error = null as { message: string } | null, throws = false } = {}) {
  const eqs: [string, unknown][] = [];
  const q = {
    select: () => q,
    eq: (col: string, v: unknown) => {
      eqs.push([col, v]);
      return q;
    },
    then: (resolve: (r: unknown) => unknown) => resolve({ data: rows, error }),
  };
  return {
    eqs,
    auth: { getSession: () => (throws ? Promise.reject(new Error("no accounts")) : Promise.resolve({ data: { session } })) },
    from: () => q,
  } as unknown as SupabaseClient & { eqs: [string, unknown][] };
}

describe("workerDevServers", () => {
  it("lists your headless workers' published dev servers, leaving out bad rows and empty workers", async () => {
    const client = fake({ rows: [{ id: "w1", name: "m1mini", owner_user: "me", dev_servers: [server, { cardId: 1 }, null] }, { id: "w2", name: "idle", owner_user: "me", dev_servers: null }] });
    expect(await workerDevServers(client)).toEqual([{ workerId: "w1", worker: "m1mini", servers: [server] }]);
    expect(client.eqs).toEqual([
      ["owner_user", "me"],
      ["kind", "headless"],
    ]);
  });

  it("drops an address that isn't Weft's own /t/<id>, and keeps one that is", async () => {
    const good = { ...server, cardId: "c2", address: "https://weft.zip/t/0f8fad5b-d9cb-469f-a165-70867728950e/app" };
    const bad = { ...server, cardId: "c3", address: "javascript:alert(1)" };
    const client = fake({ rows: [{ id: "w1", name: "m1mini", owner_user: "me", dev_servers: [good, bad] }] });
    expect((await workerDevServers(client))[0]?.servers).toEqual([good, { ...server, cardId: "c3", address: undefined }]);
  });

  it("is empty signed out, on a database error, or with no accounts", async () => {
    expect(await workerDevServers()).toEqual([]);
    expect(await workerDevServers(fake({ error: { message: "no column" } }))).toEqual([]);
    expect(await workerDevServers(fake({ throws: true }))).toEqual([]);
    expect(await workerDevServers(fake({ rows: null as unknown as unknown[] }))).toEqual([]);
  });
});
