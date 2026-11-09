import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BEAT_MS, FIRST_BEAT_MS, beatDevice, linkHost, reportLocalVaults, startDeviceBeat } from "./device-beat.cjs";

const tmp = (key: unknown = { publicKey: "pub-1", privateKey: "sealed" }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-beat-"));
  if (key) fs.writeFileSync(path.join(dir, "device-key.json"), JSON.stringify(key));
  return dir;
};

// Records the update and every filter on it.
const client = (error: { message: string } | null = null, sub: unknown = "user-1") => {
  const calls: { table?: string; patch?: unknown; filters: unknown[][] } = { filters: [] };
  const query = {
    update: (patch: unknown) => ((calls.patch = patch), query),
    eq: (...f: unknown[]) => (calls.filters.push(["eq", ...f]), query),
    is: (...f: unknown[]) => (calls.filters.push(["is", ...f]), Promise.resolve({ error })),
  };
  return { calls, accountClient: { getClaims: () => ({ sub }), supabase: { from: (table: string) => ((calls.table = table), query) } } };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("beatDevice", () => {
  it("moves last_seen_at on this user's own live row", async () => {
    const { calls, accountClient } = client();
    expect(await beatDevice({ accountClient, dir: tmp(), now: () => 0 })).toBe(true);
    expect(calls.table).toBe("devices");
    expect(calls.patch).toEqual({ last_seen_at: "1970-01-01T00:00:00.000Z" });
    expect(calls.filters).toEqual([
      ["eq", "user_id", "user-1"],
      ["eq", "public_key", "pub-1"],
      ["is", "revoked_at", null],
    ]);
  });

  it("sends nothing when signed out", async () => {
    const { calls, accountClient } = client(null, null);
    expect(await beatDevice({ accountClient, dir: tmp() })).toBe(false);
    expect(calls.table).toBeUndefined();
  });

  it("sends nothing without a key file, or with a broken one", async () => {
    const { calls, accountClient } = client();
    expect(await beatDevice({ accountClient, dir: tmp(null) })).toBe(false);
    expect(await beatDevice({ accountClient, dir: tmp({ publicKey: 7 }) })).toBe(false);
    expect(calls.table).toBeUndefined();
  });

  it("never sends the private half", async () => {
    const { calls, accountClient } = client();
    await beatDevice({ accountClient, dir: tmp() });
    expect(JSON.stringify(calls)).not.toContain("sealed");
  });

  it("warns and carries on when the server refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { accountClient } = client({ message: "nope" });
    expect(await beatDevice({ accountClient, dir: tmp() })).toBe(false);
    expect(warn).toHaveBeenCalledWith("Device beat: nope");
  });

  it("never throws, even with the client gone wrong", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const accountClient = {
      getClaims: () => {
        throw new Error("boom");
      },
    };
    expect(await beatDevice({ accountClient, dir: tmp() })).toBe(false);
    expect(warn).toHaveBeenCalledWith("Device beat: boom");
  });

  it("is quiet without any client", async () => {
    expect(await beatDevice({ accountClient: null, dir: tmp() })).toBe(false);
  });
});

describe("startDeviceBeat", () => {
  it("beats soon after launch, then on the interval, until stopped; the vault list only when it changed", async () => {
    vi.useFakeTimers();
    const { accountClient } = client();
    const from = vi.spyOn(accountClient.supabase, "from");
    const stop = startDeviceBeat({ accountClient: () => accountClient, dir: tmp() });

    expect(from).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FIRST_BEAT_MS);
    // The beat, then the first vault list.
    expect(from).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    // The list is the same, so only the beat.
    expect(from).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(BEAT_MS * 3);
    expect(from).toHaveBeenCalledTimes(3);
  });
});

const HOST = "ab".repeat(32);
const withHost = (id = HOST) => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "device-id"), `${id}\n`);
  return dir;
};

// The host link's query: update, then two eq filters, awaited. Writes land in calls; the link's read of a revoked
// heartbeat row (cloud_workers) answers `revoked`, and lands in reads.
const linkClient = (error: { message: string } | null = null, sub: unknown = "user-1", revoked: unknown[] = [], readError: unknown = null) => {
  const calls: { patch?: unknown; filters: unknown[][] }[] = [];
  const reads: { table: string; filters: unknown[][] }[] = [];
  const supabase = {
    from: (table: string) => {
      const call: { patch?: unknown; filters: unknown[][] } = { filters: [] };
      let read = false;
      // Thenable like supabase-js's builder: the link awaits it after its filters, the beat after `is`.
      const query = {
        select: () => ((read = true), reads.push({ table, filters: call.filters }), query),
        update: (patch: unknown) => ((call.patch = patch), calls.push(call), query),
        eq: (...f: unknown[]) => (call.filters.push(f), query),
        not: (...f: unknown[]) => (call.filters.push(["not", ...f]), query),
        limit: () => query,
        is: () => Promise.resolve({ error: null }),
        then: (done: (r: { data?: unknown; error: unknown }) => unknown) => done(read ? { data: revoked, error: readError } : { error }),
      };
      return query;
    },
  };
  return { calls, reads, accountClient: { getClaims: () => ({ sub }), supabase } };
};

describe("linkHost", () => {
  it("names this Mac's device id on its own key row", async () => {
    const { calls, accountClient } = linkClient();
    expect(await linkHost({ accountClient, dir: withHost() })).toBe(true);
    expect(calls[0]).toMatchObject({ patch: { host_device: HOST }, filters: [["user_id", "user-1"], ["public_key", "pub-1"]] });
  });

  it("sends nothing signed out, without a device id, or with one that isn't a device id", async () => {
    const { calls, accountClient } = linkClient();
    expect(await linkHost({ accountClient: linkClient(null, null).accountClient, dir: withHost() })).toBe(false);
    expect(await linkHost({ accountClient, dir: tmp() })).toBe(false);
    expect(await linkHost({ accountClient, dir: withHost("not-an-id") })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("leaves a revoked device id unlinked, so a re-added Mac's new key row doesn't read revoked", async () => {
    const warn = vi.fn();
    const { calls, reads, accountClient } = linkClient(null, "user-1", [{ id: "w1" }]);
    expect(await linkHost({ accountClient, dir: withHost(), warn })).toBe(true);
    expect(reads[0]).toEqual({ table: "cloud_workers", filters: [["kind", "desktop"], ["device", HOST], ["not", "revoked_at", "is", null]] });
    expect(calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("device id was revoked"));
  });

  it("tries again later when the revoked check can't be read", async () => {
    const { calls, accountClient } = linkClient(null, "user-1", [], { message: "offline" });
    expect(await linkHost({ accountClient, dir: withHost() })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("says why when the server refuses, and reports it didn't land", async () => {
    const warn = vi.fn();
    const { accountClient } = linkClient({ message: 'column "host_device" does not exist' });
    expect(await linkHost({ accountClient, dir: withHost(), warn })).toBe(false);
    expect(warn).toHaveBeenCalledWith('Device host link: column "host_device" does not exist');
  });
});

describe("startDeviceBeat's host link", () => {
  it("links once, then only beats", async () => {
    vi.useFakeTimers();
    const { calls, accountClient } = linkClient();
    const stop = startDeviceBeat({ accountClient: () => accountClient, dir: withHost() });
    await vi.advanceTimersByTimeAsync(FIRST_BEAT_MS);
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    stop();
    expect(calls.filter((c) => (c.patch as { host_device?: string }).host_device)).toHaveLength(1);
    expect(calls.filter((c) => (c.patch as { last_seen_at?: string }).last_seen_at)).toHaveLength(2);
  });

  it("keeps trying while the server refuses, and warns only once", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls, accountClient } = linkClient({ message: "no column" });
    const stop = startDeviceBeat({ accountClient: () => accountClient, dir: withHost() });
    await vi.advanceTimersByTimeAsync(FIRST_BEAT_MS);
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    stop();
    expect(calls.filter((c) => (c.patch as { host_device?: string }).host_device)).toHaveLength(2);
    expect(warn.mock.calls.filter(([line]) => String(line).startsWith("Device host link"))).toHaveLength(1);
  });
});

describe("reportLocalVaults", () => {
  const withVaults = (vaults: { id: string; secrets: unknown[] }[], shared: number[] = []) => {
    const dir = tmp();
    const vdir = path.join(dir, "vault");
    fs.mkdirSync(vdir);
    vaults.forEach((v, i) => {
      const hash = String(i).padStart(16, "0");
      fs.writeFileSync(path.join(vdir, `${hash}.json`), JSON.stringify(v));
      if (shared.includes(i)) fs.writeFileSync(path.join(vdir, `${hash}.shared.json`), "{}");
    });
    return dir;
  };

  it("names the repos of this Mac's unshared vaults on its own row", async () => {
    const { calls, accountClient } = linkClient();
    const dir = withVaults([
      { id: "github:aimhuge/weft", secrets: [{ name: "A", ciphertext: "x" }] },
      { id: "github:aimhuge/shared", secrets: [{ name: "A", ciphertext: "x" }] },
    ], [1]);
    expect(await reportLocalVaults({ accountClient, dir })).toEqual(["aimhuge/weft"]);
    expect(calls[0]).toMatchObject({ patch: { local_vaults: ["aimhuge/weft"] }, filters: [["user_id", "user-1"], ["public_key", "pub-1"]] });
  });

  it("sends nothing signed out, and null when the server refuses", async () => {
    const warn = vi.fn();
    expect(await reportLocalVaults({ accountClient: linkClient(null, null).accountClient, dir: tmp() })).toBeNull();
    expect(await reportLocalVaults({ accountClient: linkClient({ message: "no column" }).accountClient, dir: tmp(), warn })).toBeNull();
    expect(warn).toHaveBeenCalledWith("Device vault list: no column");
  });

  it("never throws", async () => {
    const accountClient = { getClaims: () => ({ sub: "user-1" }), supabase: { from: () => { throw new Error("boom"); } } };
    expect(await reportLocalVaults({ accountClient, dir: tmp() })).toBeNull();
  });
});
