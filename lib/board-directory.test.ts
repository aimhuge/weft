import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { boardDirectory, personName } from "./board-directory";

type Call = { table: string; filters: [string, string, unknown][] };

// A service client whose reads answer from `tables`, keyed by table and the first filter's column; it records each read.
function fakeService(tables: Record<string, unknown[] | Error>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, filters: [] };
    calls.push(call);
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => (call.filters.push(["eq", col, v]), q),
      in: (col: string, v: unknown) => {
        call.filters.push(["in", col, v]);
        const rows = tables[`${table}.${col}`];
        return Promise.resolve(rows instanceof Error ? { data: null, error: rows } : { data: rows ?? [], error: null });
      },
    };
    return q;
  };
  return { service: { from } as unknown as SupabaseClient, calls };
}

describe("personName", () => {
  it("takes the display name, the name, then the email's local part", () => {
    const p = { id: "u", name: null, display_name: null, email: null, avatar_url: null };
    expect(personName({ ...p, display_name: " Alex ", name: "A" })).toBe("Alex");
    expect(personName({ ...p, name: "Alex Doe" })).toBe("Alex Doe");
    expect(personName({ ...p, email: "alex@x.co" })).toBe("alex");
    expect(personName(p)).toBe("A teammate");
  });
});

describe("boardDirectory", () => {
  const rows = [
    { owner_user: "u1", owner_device: "mac1" },
    { owner_user: "u2", owner_device: "mac2" },
    { owner_user: "u1", owner_device: "worker:w1" },
    { owner_user: undefined, owner_device: "mac1" },
  ];

  it("names the people and machines on the rows, a Mac by its listed name over its device row's", async () => {
    const { service, calls } = fakeService({
      "profiles.id": [{ id: "u1", name: "Alex", display_name: null, email: null, avatar_url: "https://a" }, { id: "u2", name: null, display_name: null, email: "bea@x.co", avatar_url: null }],
      "devices.host_device": [{ host_device: "mac1", name: "Weft on MacBook-Air.local" }, { host_device: "mac2", name: "Weft on Bea.local" }, { host_device: "mac3", name: null }],
      "cloud_workers.device": [{ device: "mac1", name: "m5air" }],
      "cloud_workers.id": [{ id: "w1", name: "m1mini" }],
    });
    expect(await boardDirectory(service, rows)).toEqual({
      people: { u1: { name: "Alex", avatar: "https://a" }, u2: { name: "bea", avatar: null } },
      machines: { mac1: "m5air", mac2: "Bea", "worker:w1": "m1mini" },
    });
    // Only the ids on the rows are asked for.
    expect(calls.find((c) => c.table === "profiles")?.filters).toEqual([["in", "id", ["u1", "u2"]]]);
    expect(calls.find((c) => c.table === "devices")?.filters).toEqual([["eq", "kind", "desktop"], ["in", "host_device", ["mac1", "mac2"]]]);
  });

  it("reads nothing for no rows, and leaves out what a failed read couldn't name", async () => {
    const empty = fakeService({});
    expect(await boardDirectory(empty.service, [])).toEqual({ people: {}, machines: {} });
    expect(empty.calls).toEqual([]);
    const failing = fakeService({ "profiles.id": new Error("x"), "devices.host_device": new Error("x"), "cloud_workers.device": new Error("x"), "cloud_workers.id": new Error("x") });
    expect(await boardDirectory(failing.service, rows)).toEqual({ people: {}, machines: {} });
  });
});
